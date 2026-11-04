import { createLogger } from './logger';
import { track } from './track';
import { theme } from './theme';
export const mobileExported = () => null;
const mobileLogger = createLogger('mobile');
const mobileShared = () => track('mobile');
const mobileTheme = theme;
const mobileStub = () => null;
export const impl = () => null;
export const logger = () => null;
export const shared = () => null;
export const themed = () => null;
export const stub = () => null;
export const alsoShared = mobileShared;
export function render(mobileTheme) {
    return mobileTheme;
}
export function fallback() {
    return mobileStub;
}
