/**
 * data.js — Google Sheets CSV fetching and parsing
 *
 * Two data sources:
 * 1. SUMMARY sheet (gid=603715759): Creator list + posts + double (static totals)
 * 2. REFERRALS sheet (gid=1587650016): Individual referral rows with dates
 *
 * Referrals are counted dynamically based on the selected time window,
 * using column M (date DD/MM/YYYY) from the referrals sheet.
 * Only rows with column N (Agenciado) marked as "Sim" are counted.
 */

import { calculateScore } from './utils.js';

// ==================================================================
// CONFIGURATION
// ==================================================================
const SUMMARY_CSV_URL =
    'https://docs.google.com/spreadsheets/d/1E8mcrg9b2diShYafCme0sy-SqMo3prf0/export?format=csv&gid=603715759';

const REFERRALS_CSV_URL =
    'https://docs.google.com/spreadsheets/d/1E8mcrg9b2diShYafCme0sy-SqMo3prf0/export?format=csv&gid=1587650016';

// Double-point period (06/04 – 12/04)
const DOUBLE_START = new Date(2026, 3, 6);  // April 6 (months are 0-indexed)
const DOUBLE_END   = new Date(2026, 3, 12, 23, 59, 59);

// ==================================================================
// CSV Parsing Helpers
// ==================================================================

/**
 * Full CSV parser that handles:
 * - Quoted fields with commas inside
 * - Newlines inside quoted fields
 * - Escaped double quotes ("")
 * Returns an array of rows, each row is an array of string values.
 */
function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                // Check for escaped quote ""
                if (i + 1 < text.length && text[i + 1] === '"') {
                    current += '"';
                    i++; // skip next quote
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(current);
                current = '';
            } else if (char === '\r') {
                // skip \r
            } else if (char === '\n') {
                row.push(current);
                current = '';
                rows.push(row);
                row = [];
            } else {
                current += char;
            }
        }
    }

    // Push final field and row
    if (current || row.length > 0) {
        row.push(current);
        rows.push(row);
    }

    return rows;
}

/**
 * Clean creator name (remove invisible characters)
 */
function cleanName(str) {
    if (!str) return '';
    return str.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '').trim();
}

/**
 * Parse a numeric string
 */
function parseNum(str) {
    if (!str) return 0;
    const n = parseInt(str.toString().trim(), 10);
    return isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Parse date string DD/MM/YYYY to a Date object.
 * Returns null if invalid.
 */
function parseDateDDMMYYYY(str) {
    if (!str) return null;
    const cleaned = str.trim();
    const [day, month, year] = cleaned.split('/');
    if (day && month && year) {
        const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function normalizeText(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function isMarkedYes(str) {
    return normalizeText(str) === 'sim';
}

// ==================================================================
// SUMMARY SHEET PARSER
// ==================================================================

/**
 * Parse the summary CSV into a map of { handle: { name, handle, posts, double } }
 */
function parseSummaryCSV(csv) {
    const rows = parseCSV(csv);
    if (rows.length < 2) return new Map();

    const headers = rows[0].map(h => h.trim().toLowerCase());

    const colMap = {
        name:   headers.findIndex(h => h.includes('nome') || h === 'name'),
        handle: headers.findIndex(h => h.includes('usuario') || h.includes('user') || h === '@usuario'),
        posts:  headers.findIndex(h => h.includes('post') || h.includes('reels') || h.includes('tiktok')),
        // double from summary is the total double content count
        double: headers.findIndex(h => h.includes('double') || h.includes('duplo')),
    };

    const map = new Map();

    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const name = colMap.name >= 0 ? cleanName(cols[colMap.name]) : '';
        if (!name) continue;

        let handle = colMap.handle >= 0 ? (cols[colMap.handle] || '').trim() : '';
        if (handle && !handle.startsWith('@')) handle = '@' + handle;
        const key = handle ? handle.toLowerCase() : name.toLowerCase();

        const posts  = colMap.posts  >= 0 ? parseNum(cols[colMap.posts])  : 0;
        const double = colMap.double >= 0 ? parseNum(cols[colMap.double]) : 0;

        map.set(key, { name, handle, posts, double });
    }

    return map;
}

// ==================================================================
// REFERRALS SHEET PARSER
// ==================================================================

/**
 * Parse the referrals CSV into an array of { utmSource, date }
 * Column J (index 9) = UTM_Source (who referred)
 * Column M (index 12) = Date DD/MM/YYYY
 * Column N (index 13) = Agenciado ("Sim" / "Não")
 */
function parseReferralsCSV(csv) {
    const rows = parseCSV(csv);
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => normalizeText(h));
    const agenciadoIndex = headers.findIndex(h => h.includes('agenciado'));
    const agenciadoColumn = agenciadoIndex >= 0 ? agenciadoIndex : 13;
    const entries = [];

    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length <= agenciadoColumn) continue; // skip incomplete rows

        // Only count referrals that actually became agenciados.
        if (!isMarkedYes(cols[agenciadoColumn])) continue;

        // UTM_Source is column J (index 9)
        const utmSource = (cols[9] || '').trim().toLowerCase();
        if (!utmSource) continue;

        // Date is column M (index 12) in DD/MM/YYYY
        const dateStr = (cols[12] || '').trim();
        const date = parseDateDDMMYYYY(dateStr);
        if (!date) continue;

        entries.push({ utmSource, date });
    }

    return entries;
}

// ==================================================================
// DATA FETCHING
// ==================================================================

/**
 * Fetch both sheets and return the raw parsed data
 */
export async function fetchRawData() {
    let summaryMap = new Map();
    let referralEntries = [];

    try {
        const [summaryRes, referralsRes] = await Promise.all([
            fetch(SUMMARY_CSV_URL),
            fetch(REFERRALS_CSV_URL),
        ]);

        if (summaryRes.ok) {
            const csvText = await summaryRes.text();
            summaryMap = parseSummaryCSV(csvText);
        }

        if (referralsRes.ok) {
            const csvText = await referralsRes.text();
            referralEntries = parseReferralsCSV(csvText);
        }
    } catch (err) {
        console.warn('Error fetching sheets:', err.message);
    }

    return { summaryMap, referralEntries };
}

// ==================================================================
// TIME WINDOW HELPERS
// ==================================================================

/**
 * Get the start of a given day (00:00:00.000)
 */
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Determine time window boundaries based on filter value.
 *
 * - 'this_month': 1st to last day of current month
 * - 'last_month': 1st to last day of previous month
 * - '7': from yesterday going back 7 days (yesterday minus 6 days → yesterday)
 * - '14': from yesterday going back 14 days
 * - 'all': no filter
 *
 * Returns { start: Date, end: Date } or null for 'all'
 */
function getTimeWindow(filter) {
    const now = new Date();
    const today = startOfDay(now);

    if (filter === 'all') {
        return null;
    }

    if (filter === 'this_month') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
        return { start, end };
    }

    if (filter === 'last_month') {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
        return { start, end };
    }

    // '7' or '14' — start from yesterday and go back N days
    const days = parseInt(filter, 10);
    if (!isNaN(days) && days > 0) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const start = new Date(yesterday);
        start.setDate(start.getDate() - (days - 1));

        return { start: startOfDay(start), end: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59) };
    }

    return null;
}

/**
 * Check if a date falls within a time window
 */
function isInWindow(date, window) {
    if (!window) return true; // 'all' filter
    return date >= window.start && date <= window.end;
}

// ==================================================================
// PROCESSING & AGGREGATION
// ==================================================================

/**
 * Process raw data: count referrals per creator within the time window,
 * check for double-point referrals, merge with summary (posts, static double),
 * calculate scores, and sort.
 */
export function processAndAggregateData(rawData, timeWindow) {
    const { summaryMap, referralEntries } = rawData;

    const window = getTimeWindow(timeWindow);

    // 1. Count referrals per UTM source within the time window
    //    Also count "double" referrals (those within the double-point period)
    const referralCounts = new Map();
    const doubleCounts   = new Map();

    referralEntries.forEach(entry => {
        if (!isInWindow(entry.date, window)) return;

        const key = entry.utmSource;
        referralCounts.set(key, (referralCounts.get(key) || 0) + 1);

        // Check if this referral falls within the double-point period
        if (entry.date >= DOUBLE_START && entry.date <= DOUBLE_END) {
            doubleCounts.set(key, (doubleCounts.get(key) || 0) + 1);
        }
    });

    // 2. Build the final creators array
    //    We use all creators from the summary sheet as the master list
    const creators = [];

    summaryMap.forEach((info, key) => {
        // Match referrals by UTM source (handle without @)
        const handleClean = info.handle ? info.handle.replace(/^@/, '').toLowerCase() : '';
        const nameClean   = info.name.toLowerCase();

        // Try to match by handle first, then by name
        const referrals = referralCounts.get(handleClean) || referralCounts.get(nameClean) || 0;
        const doubleReferrals = doubleCounts.get(handleClean) || doubleCounts.get(nameClean) || 0;

        const scores = calculateScore({
            referrals,
            posts: info.posts,
            double: doubleReferrals,
        });

        creators.push({
            name: info.name,
            handle: info.handle,
            referrals,
            posts: info.posts,
            double: doubleReferrals,
            ...scores,
        });
    });

    // 3. Sort by total points descending
    creators.sort((a, b) => b.totalPoints - a.totalPoints);

    // 4. Assign rank
    creators.forEach((creator, idx) => {
        creator.rank = idx + 1;
    });

    return creators;
}
