import { authRequest } from '../../server/melhores-auth.js';
import { serve } from '../../server/melhores-netlify.js';

export default request => serve(request, r => authRequest(r), ['GET', 'POST']);
