import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Moon, Sun, TerminalSquare } from 'lucide-react';

export const ThemeSwitcher: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1.5 p-1 bg-slate-900/50 rounded-xl border border-slate-700/50 backdrop-blur-md">
      <button
        onClick={() => setTheme('light')}
        className={`p-2 rounded-lg flex items-center justify-center transition-all ${
          theme === 'light' 
            ? 'bg-white text-slate-100 shadow-md shadow-slate-200/50' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`}
        title="밝은 테마 (Light)"
      >
        <Sun className="w-4 h-4" />
      </button>

      <button
        onClick={() => setTheme('dark')}
        className={`p-2 rounded-lg flex items-center justify-center transition-all ${
          theme === 'dark' 
            ? 'bg-slate-700 text-indigo-300 shadow-md shadow-slate-900/50 ring-1 ring-slate-600' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`}
        title="어두운 테마 (Dark)"
      >
        <Moon className="w-4 h-4" />
      </button>

      <button
        onClick={() => setTheme('dev')}
        className={`p-2 rounded-lg flex items-center justify-center transition-all ${
          theme === 'dev' 
            ? 'bg-black text-mantis-400 shadow-md shadow-mantis-500/20 ring-1 ring-mantis-500/50' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`}
        title="개발자 테마 (Developer)"
      >
        <TerminalSquare className="w-4 h-4" />
      </button>
    </div>
  );
};
