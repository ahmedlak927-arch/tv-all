'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/navigation';

interface Stats {
  total: number;
  devices: {
    iphone: number;
    android: number;
    laptop: number;
    other: number;
  };
  browsers: {
    chrome: number;
    other: number;
  };
  countries: Record<string, number>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [stats, setStats] = useState<Stats>({
    total: 1,
    devices: { iphone: 0, android: 0, laptop: 0, other: 0 },
    browsers: { chrome: 0, other: 0 },
    countries: {},
  });

  useEffect(() => {
    // 1. Detect User Device & Browser
    const getClientDetails = () => {
      const ua = navigator.userAgent;
      let device = 'laptop';
      if (/iphone|ipad|ipod/i.test(ua)) {
        device = 'iphone';
      } else if (/android/i.test(ua)) {
        device = 'android';
      } else if (/windows|macintosh|linux/i.test(ua)) {
        device = 'laptop';
      } else {
        device = 'other';
      }

      let browser = 'other';
      if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) {
        browser = 'chrome';
      }

      return { device, browser };
    };

    // 2. Fetch Country via IP Geolocation (Fallback to 'Unknown')
    const fetchCountry = async (): Promise<string> => {
      try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        return data.country_name || 'Unknown';
      } catch {
        return 'Unknown';
      }
    };

    let channelRoom: any;

    const initPresence = async () => {
      const { device, browser } = getClientDetails();
      const country = await fetchCountry();

      channelRoom = supabase.channel('online_users_room', {
        config: {
          presence: {
            key: crypto.randomUUID(),
          },
        },
      });

      channelRoom
        .on('presence', { event: 'sync' }, () => {
          const state = channelRoom.presenceState();
          
          let total = 0;
          let iphone = 0;
          let android = 0;
          let laptop = 0;
          let otherDevice = 0;
          let chrome = 0;
          let otherBrowser = 0;
          const countries: Record<string, number> = {};

          Object.values(state).forEach((presences: any) => {
            presences.forEach((p: any) => {
              total++;
              if (p.device === 'iphone') iphone++;
              else if (p.device === 'android') android++;
              else if (p.device === 'laptop') laptop++;
              else otherDevice++;

              if (p.browser === 'chrome') chrome++;
              else otherBrowser++;

              const c = p.country || 'Unknown';
              countries[c] = (countries[c] || 0) + 1;
            });
          });

          setStats({
            total: total > 0 ? total : 1,
            devices: { iphone, android, laptop, other: otherDevice },
            browsers: { chrome, other: otherBrowser },
            countries,
          });
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await channelRoom.track({
              device,
              browser,
              country,
              online_at: new Date().toISOString(),
            });
          }
        });
    };

    initPresence();

    return () => {
      if (channelRoom) {
        supabase.removeChannel(channelRoom);
      }
    };
  }, []);

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkMode 
        ? 'bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white' 
        : 'bg-gradient-to-br from-blue-50 via-white to-purple-50 text-gray-900'
    }`}>
      {/* Admin Header */}
      <header className={`border-b backdrop-blur-lg ${
        isDarkMode ? 'bg-gray-950/90 border-gray-800' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg text-xl">
              📊
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Admin Statistics</h1>
              <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Live Analytics Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
              }`}
            >
              Back to App
            </button>
          </div>
        </div>
      </header>

      {/* Admin Content */}
      <main className="container mx-auto px-6 py-8 max-w-7xl">
        <h2 className="text-lg font-semibold mb-6">Audience Breakdown</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Online Card */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <span className="text-sm font-medium text-gray-400">Total Online Users</span>
            <div className="text-4xl font-extrabold text-blue-400 mt-2">{stats.total}</div>
          </div>

          {/* iPhone Card */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <span className="text-sm font-medium text-gray-400">📱 iPhone Users</span>
            <div className="text-4xl font-extrabold text-purple-400 mt-2">{stats.devices.iphone}</div>
          </div>

          {/* Android Card */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <span className="text-sm font-medium text-gray-400">🤖 Android Users</span>
            <div className="text-4xl font-extrabold text-emerald-400 mt-2">{stats.devices.android}</div>
          </div>

          {/* Laptop Card */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <span className="text-sm font-medium text-gray-400">💻 Laptop / Desktop</span>
            <div className="text-4xl font-extrabold text-yellow-400 mt-2">{stats.devices.laptop}</div>
          </div>
        </div>

        {/* Secondary Grid (Browser & Country) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Browsers Breakdown */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <h3 className="text-base font-semibold mb-4">Browser Breakdown</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">🌐 Chrome Browser</span>
                <span className="font-bold text-lg">{stats.browsers.chrome}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">🌐 Other Browsers (Safari, Firefox, etc.)</span>
                <span className="font-bold text-lg">{stats.browsers.other}</span>
              </div>
            </div>
          </div>

          {/* Country Breakdown */}
          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <h3 className="text-base font-semibold mb-4">🌍 Geographic Breakdown (Countries)</h3>
            <div className="space-y-3">
              {Object.keys(stats.countries).length === 0 ? (
                <p className="text-xs text-gray-500">Loading country data...</p>
              ) : (
                Object.entries(stats.countries).map(([country, count]) => (
                  <div key={country} className="flex justify-between items-center text-sm">
                    <span className="text-gray-400 flex items-center gap-2">
                      {country === 'Iraq' ? '🇮🇶 Iraq' : '🏳️'} {country}
                    </span>
                    <span className="font-bold text-lg bg-blue-500/10 text-blue-400 px-3 py-1 rounded-lg">
                      {count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}