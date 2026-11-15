import { switchBuildCondition } from '@memebattle/build-conditions';
import { createLogger } from './logger';
import { track } from './track';
import { theme } from './theme';
export const mobileExported = () => null;
const mobileLogger = createLogger('mobile');
const mobileShared = () => track('mobile');
const mobileTheme = theme;
const mobileStub = () => null;
export const impl = switchBuildCondition({ desktop: () => null, mobile: mobileExported });
export const logger = switchBuildCondition({ desktop: () => null, mobile: mobileLogger });
export const shared = switchBuildCondition({ desktop: () => null, mobile: mobileShared });
export const themed = switchBuildCondition({ desktop: () => null, mobile: mobileTheme });
export const stub = switchBuildCondition({ desktop: () => null, mobile: mobileStub });
export const alsoShared = mobileShared;
export function render(mobileTheme) {
    return mobileTheme;
}
export function fallback() {
    return mobileStub;
}
