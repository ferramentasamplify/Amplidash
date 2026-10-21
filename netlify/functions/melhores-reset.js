import { handleMelhoresResetRequest } from '../../server/melhores-api.js';
import { serve } from '../../server/melhores-netlify.js';

export default request => serve(request, r => handleMelhoresResetRequest(r), ['POST']);
