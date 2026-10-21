import { roomRequest } from '../../server/melhores-room.js';
import { serve } from '../../server/melhores-netlify.js';

export default request => serve(request, r => roomRequest(r), ['GET', 'POST']);
