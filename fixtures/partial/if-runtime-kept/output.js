import { isBuildConditions } from '@memebattle/build-conditions';
import { desktopImpl } from './impl@desktop';
export function run() {
    if (isBuildConditions('desktop')) {
        desktopImpl();
    }
}
