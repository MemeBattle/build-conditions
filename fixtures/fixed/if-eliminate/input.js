import { isBuildConditions } from '@memebattle/build-conditions';
import { initDesktopMenu } from './menu@desktop';
import { initMobileMenu } from './menu@mobile';
import { initServerLogger } from './logger@server';
export function init() {
    if (isBuildConditions('mobile')) {
        initMobileMenu();
    } else {
        initDesktopMenu();
    }
    if (isBuildConditions('server')) {
        initServerLogger();
    }
}
