import { handleMelhoresApplyRequest } from '../../server/melhores-api.js';
import { serve } from '../../server/melhores-netlify.js';

export default request => serve(request, r => handleMelhoresApplyRequest(r.body, r), ['POST']);
