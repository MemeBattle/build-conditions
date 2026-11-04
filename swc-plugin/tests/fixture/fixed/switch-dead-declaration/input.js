import { switchBuildCondition } from 'build-conditions';
import Cookies from 'js-cookie';
import { getLoggerPlugin } from './logger';
const createClientHost = () => ({
    getToken: () => Cookies.get('token'),
});
function createServerHost() {
    return { plugins: [getLoggerPlugin] };
}
export const createHost = switchBuildCondition({
    client: createClientHost,
    server: createServerHost,
});
