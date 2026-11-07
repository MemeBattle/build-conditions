import { isBuildConditions } from '@memebattle/build-conditions';
import { desktopOnly } from './desktopOnly';
export function run() {
    if (!isBuildConditions('desktop')) {
        throw new Error('not desktop');
    }
    desktopOnly();
}
