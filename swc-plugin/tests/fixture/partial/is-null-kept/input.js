import { isBuildConditions } from '@memebattle/build-conditions';
export const isDesktop = isBuildConditions('desktop');
export const isClient = isBuildConditions('client');
export const both = isBuildConditions(['desktop', 'client']);
