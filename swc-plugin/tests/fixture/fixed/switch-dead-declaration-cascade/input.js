import { switchBuildCondition } from '@memebattle/build-conditions';
import { getPassportHost } from './passport';
import { track } from './track';
const getAuthUrl = () => getPassportHost() + '/auth';
const mobileOptions = { onAuth: () => track('auth') };
const desktopImpl = () => null;
const mobileImpl = () => getAuthUrl(mobileOptions);
export const impl = switchBuildCondition({
    desktop: desktopImpl,
    mobile: mobileImpl,
});
