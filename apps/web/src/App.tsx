import { useCallback, useEffect, useState } from 'react';
import { useMicFeatures } from './lib/audio/useMicFeatures';
import { type Settings, getSettings } from './lib/db';
import { useRoute } from './lib/router';
import { Calibrate } from './screens/Calibrate';
import { Drill } from './screens/Drill';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/Settings';

export function App() {
  const route = useRoute();
  const mic = useMicFeatures();
  const [settings, setSettings] = useState<Settings | null>(null);

  const refresh = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The mic is only ever open on the two screens that use it. Leaving one
  // releases the device, so the OS recording indicator is honest.
  const needsMic = route === '/drill' || route === '/calibrate';
  const { stop } = mic;
  useEffect(() => {
    if (!needsMic) stop();
  }, [needsMic, stop]);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  switch (route) {
    case '/calibrate':
      return <Calibrate mic={mic} settings={settings} onSaved={refresh} />;
    case '/drill':
      return <Drill mic={mic} settings={settings} />;
    case '/history':
      return <History />;
    case '/settings':
      return <SettingsScreen settings={settings} onChanged={refresh} />;
    default:
      return <Home settings={settings} />;
  }
}
