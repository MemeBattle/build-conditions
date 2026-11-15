import { switchBuildCondition } from '@memebattle/build-conditions';
import { desktop } from './impl@desktop';
import { mobile } from './impl@mobile';
export const impl = switchBuildCondition({ desktop, mobile });
