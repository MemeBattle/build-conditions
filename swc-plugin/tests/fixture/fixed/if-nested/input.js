import { isBuildConditions } from '@memebattle/build-conditions';
import { desktopClient } from './desktopClient';
import { desktopServer } from './desktopServer';
import { mobileImpl } from './mobileImpl';
export function run() {
    if (isBuildConditions('desktop')) {
        if (isBuildConditions('server')) {
            desktopServer();
        } else {
            desktopClient();
        }
    } else {
        mobileImpl();
    }
}
