'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { supabase } from './lib/supabase';

interface Channel {
  id: number;
  name: string;
  streamUrl: string;
  category: string;
  icon: string;
  isActive: boolean;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isTV, setIsTV] = useState(false);
  
  // NEW: State to track online users count
  const [onlineUsersCount, setOnlineUsersCount] = useState<number>(1);

  // Detect Smart TV Environment
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isSmartTV =
      userAgent.includes('smarttv') ||
      userAgent.includes('tizen') ||
      userAgent.includes('webos') ||
      (userAgent.includes('android') && userAgent.includes('tv')) ||
      userAgent.includes('vizio') ||
      userAgent.includes('sony') ||
      userAgent.includes('samsung');

    setIsTV(isSmartTV);
  }, []);

  // NEW: Track Online Users via Supabase Presence
  useEffect(() => {
    const room = supabase.channel('online_users_room', {
      config: {
        presence: {
          key: crypto.randomUUID(), // Unique identifier for this browser tab/session
        },
      },
    });

    room
      .on('presence', { event: 'sync' }, () => {
        const state = room.presenceState();
        // Count how many unique sessions are currently registered in the room
        const totalUsers = Object.keys(state).length;
        setOnlineUsersCount(totalUsers > 0 ? totalUsers : 1);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track this user's presence entry
          await room.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(room);
    };
  }, []);

  // Fetch Channels from Supabase
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        setLoadingChannels(true);
        setError(null);

        const { data, error } = await supabase
          .from('channels')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (error) {
          console.error('Error fetching channels:', error);
          setError(`Database error: ${error.message}`);
        } else if (data && data.length > 0) {
          const mappedData: Channel[] = data.map((item: any) => ({
            id: item.id,
            name: item.name || 'Unknown Channel',
            streamUrl: item.stream_url || '',
            category: item.category || 'General',
            icon: item.icon || 'https://via.placeholder.com/200x200/1f2937/ffffff?text=📺',
            isActive: item.is_active ?? true,
          }));
          setChannels(mappedData);
        }
      } catch (err: any) {
        console.error('Unexpected error:', err);
        setError('Failed to fetch channels');
      } finally {
        setLoadingChannels(false);
      }
    };

    fetchChannels();

    // Subscribe to real-time changes
    const channelSubscription = supabase
      .channel('channel_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'channels' },
        () => {
          fetchChannels();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelSubscription);
    };
  }, []);

  // Clean up player instance
  const cleanupPlayer = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.load();
    }
  };

  useEffect(() => {
    return cleanupPlayer;
  }, []);

  // Unique categories list
  const categories = ['All', ...Array.from(new Set(channels.map((ch) => ch.category)))];

  // Filter channels based on search and selected category
  const filteredChannels = channels.filter((channel) => {
    const matchesSearch = channel.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || channel.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // HLS Stream Loading Mechanism
  const loadStream = (rawStreamUrl: string, retryCount = 0) => {
    const video = videoRef.current;
    if (!video) return;

    if (!rawStreamUrl || rawStreamUrl.trim() === '') {
      setError('Invalid stream URL');
      setIsLoadingStream(false);
      return;
    }

    setIsLoadingStream(true);
    setError(null);

    // Clean previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const proxiedUrl = `/api/hls?url=${encodeURIComponent(rawStreamUrl)}`;
    const streamUrl = isTV ? rawStreamUrl : proxiedUrl;

    const playVideo = async () => {
      try {
        video.muted = false;
        await video.play();
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Autoplay failed:', err);
        }
      }
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = rawStreamUrl;
      video.onloadedmetadata = () => {
        setIsLoadingStream(false);
        playVideo();
      };
      video.onerror = () => {
        if (retryCount < 2) {
          retryTimeoutRef.current = setTimeout(() => loadStream(rawStreamUrl, retryCount + 1), 1500);
        } else {
          setIsLoadingStream(false);
          setError('Playback error. Stream could not be played.');
        }
      };
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveDurationInfinity: true,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 20000,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoadingStream(false);
        playVideo();
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (retryCount < 2) {
                retryTimeoutRef.current = setTimeout(() => loadStream(rawStreamUrl, retryCount + 1), 2000);
              } else {
                setIsLoadingStream(false);
                setError('Network error: Unable to connect to live stream.');
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setIsLoadingStream(false);
              setError('Fatal stream error occurred.');
              hls.destroy();
              break;
          }
        }
      });
    } else {
      setIsLoadingStream(false);
      setError('HLS playback is not supported in this browser.');
    }
  };

  const handleChannelClick = (channel: Channel) => {
    cleanupPlayer();

    if (!channel.streamUrl || channel.streamUrl.trim() === '') {
      setError(`Channel "${channel.name}" has no stream URL`);
      return;
    }

    setSelectedChannel(channel);
    setCurrentChannel(channel);
    setShowModal(true);
    setError(null);

    setTimeout(() => {
      loadStream(channel.streamUrl);
    }, 300);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    cleanupPlayer();
    setCurrentChannel(null);
    setSelectedChannel(null);
    setIsLoadingStream(false);
    setError(null);
  };

  if (loadingChannels) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-800'}`}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-14 w-14 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-4 font-medium text-sm">Loading channels...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkMode 
        ? 'bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white' 
        : 'bg-gradient-to-br from-blue-50 via-white to-purple-50 text-gray-900'
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 transition-colors duration-300 border-b backdrop-blur-lg ${
        isDarkMode ? 'bg-gray-950/90 border-gray-800' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 text-xl">
              📺
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">
                IPTV Player
                {isTV && <span className="text-xs ml-2 font-normal text-blue-400">(TV Mode)</span>}
              </h1>
              <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {channels.length} Channels Available
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* NEW: Online Users Badge */}
            {/* <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
              isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-300' : 'bg-white border-gray-200 text-gray-700 shadow-sm'
            }`}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span><strong>{onlineUsersCount}</strong> online</span>
            </div> */}

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2.5 rounded-xl transition-all ${
                isDarkMode ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {isDarkMode ? '🌞' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Mobile Online Users Counter */}
        <div className="sm:hidden mb-4 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium bg-gray-900 border-gray-800 text-gray-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span><strong>{onlineUsersCount}</strong> users online right now</span>
        </div>

        {/* Error Alert */}
        {error && !showModal && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
            <span className="text-red-400 text-sm">⚠️ {error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-lg hover:bg-red-500/30 transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search & Categories Bar */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search channels..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full rounded-xl px-4 py-3 text-sm transition-all border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkMode 
                  ? 'bg-gray-900 border-gray-800 text-white placeholder-gray-500' 
                  : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400 shadow-sm'
              }`}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === category
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25'
                    : isDarkMode
                    ? 'bg-gray-900 text-gray-300 hover:bg-gray-800 border border-gray-800'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Channel Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredChannels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => handleChannelClick(channel)}
              className={`group relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-2xl text-left border ${
                isDarkMode 
                  ? 'bg-gray-900 border-gray-800 hover:border-blue-500/50' 
                  : 'bg-white border-gray-200 hover:border-blue-500/50 shadow-sm'
              }`}
            >
              <div className="relative aspect-square w-full bg-neutral-900 overflow-hidden">
                <img
                  src={channel.icon}
                  alt={channel.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>

                <div className="absolute top-2 right-2 px-2.5 py-0.5 rounded-lg text-[10px] font-medium bg-black/60 text-gray-200 backdrop-blur-md border border-white/10">
                  {channel.category}
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-3">
                <h3 className="text-white font-semibold text-sm truncate text-center">
                  {channel.name}
                </h3>
              </div>

              {/* Play Overlay Icon */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/30 backdrop-blur-[2px]">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-xl transform group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>

        {filteredChannels.length === 0 && (
          <div className={`text-center py-16 rounded-2xl border ${
            isDarkMode ? 'bg-gray-900/50 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-500'
          }`}>
            <p className="text-base font-medium">No channels found matching your query.</p>
          </div>
        )}
      </main>

      {/* Video Player Modal */}
      {showModal && selectedChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
            onClick={handleCloseModal}
          ></div>

          <div className={`relative rounded-2xl w-full max-w-4xl border shadow-2xl overflow-hidden z-10 ${
            isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
          }`}>
            {/* Modal Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${
              isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={selectedChannel.icon}
                  alt={selectedChannel.name}
                  className="w-10 h-10 rounded-lg object-cover bg-neutral-800 flex-shrink-0"
                  onError={(e) => {
                    e.currentTarget.src = 'https://via.placeholder.com/48x48/1f2937/ffffff?text=📺';
                  }}
                />
                <div className="min-w-0">
                  <h3 className={`font-bold text-base truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {selectedChannel.name}
                  </h3>
                  <p className="text-xs text-gray-400 truncate">{selectedChannel.category}</p>
                </div>
              </div>

              <button
                onClick={handleCloseModal}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                ✕
              </button>
            </div>

            {/* Video Viewport */}
            <div className="relative bg-black aspect-video w-full flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                controls
                playsInline
                autoPlay
              />

              {/* Stream Loading Overlay */}
              {isLoadingStream && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                    <p className="text-white mt-3 text-sm font-medium">Connecting to stream...</p>
                  </div>
                </div>
              )}

              {/* Modal Stream Error Overlay */}
              {error && (
                <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-20">
                  <p className="text-red-400 text-sm font-medium mb-4">⚠️ {error}</p>
                  <button
                    onClick={() => {
                      if (selectedChannel) loadStream(selectedChannel.streamUrl);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition shadow-lg"
                  >
                    Retry Connection
                  </button>
                </div>
              )}

              {/* Live Indicator */}
              {!isLoadingStream && !error && (
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg flex items-center gap-2 border border-white/10">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                  <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">LIVE</span>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className={`px-6 py-4 flex items-center justify-between border-t ${
              isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50'
            }`}>
              <span className={`text-xs truncate max-w-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}></span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (selectedChannel) {
                      cleanupPlayer();
                      setTimeout(() => loadStream(selectedChannel.streamUrl), 200);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition"
                >
                  Reload Stream
                </button>
                <button
                  onClick={handleCloseModal}
                  className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                    isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  }`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}