import { handleMelhoresSavesRequest } from '../../server/melhores-api.js';
import { serve } from '../../server/melhores-netlify.js';

export default request => serve(request, r => handleMelhoresSavesRequest(r.body, r.method, r), ['GET', 'POST']);
