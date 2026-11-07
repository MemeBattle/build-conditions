import { isBuildConditions } from '@memebattle/build-conditions';

// 'tablet' is not a value of any group of the config
export const isTablet = isBuildConditions('tablet');
