import { isBuildConditions } from '@memebattle/build-conditions';
export const isDesktop = isBuildConditions('desktop');
export const isMobile = isBuildConditions('mobile');
export const isDesktopClient = isBuildConditions(['desktop', 'client']);
export const isDesktopServer = isBuildConditions(['desktop', 'server']);
