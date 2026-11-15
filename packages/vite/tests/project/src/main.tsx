import { isBuildConditions, switchBuildCondition } from '@memebattle/build-conditions';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import DesktopHeader from './Header@desktop.tsx';
import MobileHeader from './Header@mobile.tsx';

const Header = switchBuildCondition({ desktop: DesktopHeader, mobile: MobileHeader });

function App() {
    const [count, setCount] = useState(0);

    return (
        <main>
            <Header />
            <button onClick={() => setCount(value => value + 1)}>clicked {count} times</button>
        </main>
    );
}

if (isBuildConditions('mobile')) {
    import('./mobile-only.ts').then(module => module.init());
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
