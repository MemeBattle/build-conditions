import { isBuildConditions } from '@memebattle/build-conditions';
import { mobileGetter, mobileSetter } from './mobileOnly';

export function run() {
    if (isBuildConditions('mobile')) {
        ({
            get x() {
                var q = mobileGetter();
                return q;
            },
        });
    }
    if (isBuildConditions('mobile')) {
        ({
            set x(value) {
                var q = mobileSetter(value);
            },
        });
    }
}
