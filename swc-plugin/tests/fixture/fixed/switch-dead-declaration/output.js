import Cookies from 'js-cookie';
const createClientHost = () => ({
    getToken: () => Cookies.get('token'),
});
export const createHost = createClientHost;
