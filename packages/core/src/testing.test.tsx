import { render, screen } from '@testing-library/react';

import { switchBuildCondition } from './index';
import { resetBuildConditionsStorage, withBuildConditions } from './testing';

beforeEach(() => {
    resetBuildConditionsStorage();
});

describe('withBuildConditions', () => {
    it('sets the conditions before rendering the story', () => {
        const Component = switchBuildCondition({
            desktop: () => <div data-testid="story">desktop</div>,
            mobile: () => <div data-testid="story">mobile</div>,
        });

        const decorator = withBuildConditions({ platform: 'mobile', runtime: 'client' });

        render(decorator(() => <Component />));

        expect(screen.getByTestId('story')).toHaveTextContent('mobile');
    });
});
