import { serve } from '../../server/melhores-netlify.js';
import { adminRequest } from '../../server/melhores-admin.js';
export default request => serve(request, adminRequest);
