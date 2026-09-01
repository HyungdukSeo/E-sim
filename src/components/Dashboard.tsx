import React, { useMemo } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  PieChart as PieIcon, 
  FileCode, 
  Users, 
  AlertCircle, 
  CheckCircle2, 
  FolderKanban,
  Building2,
  Layers
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { CRItem, FilterState } from '../types/cr';

interface DashboardProps {
  allCrs: CRItem[];
  onApplyFilter: (updater: (prev: FilterState) => FilterState) => void;
  onSwitchToSearch: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  opened: '#ef4444',
  resolved: '#22c55e',
  submitted: '#f59e0b',
  validated: '#3b82f6',
  live: '#a855f7',
  assigned: '#06b6d4',
  postponed: '#64748b',
  disposed: '#94a3b8',
  released: '#10b981',
};

const PROJECT_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', 
  '#06b6d4', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
];

export const Dashboard: React.FC<DashboardProps> = ({
  allCrs,
  onApplyFilter,
  onSwitchToSearch
}) => {
  // Aggregate statistics
  const stats = useMemo(() => {
    const total = allCrs.length;
    let openedCount = 0;
    let resolvedCount = 0;
    let withCheckinCount = 0;

    const statusCounts: Record<string, number> = {};
    const projectCounts: Record<string, number> = {};
    const customerCounts: Record<string, number> = {};
    const reporterCounts: Record<string, number> = {};
    const monthlyCounts: Record<string, { total: number; resolved: number; opened: number }> = {};
    const fileCounts: Record<string, number> = {};

    allCrs.forEach(cr => {
      // Status
      const st = cr.status || 'unknown';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      if (st === 'opened' || st === 'submitted') openedCount++;
      if (st === 'resolved' || st === 'validated' || st === 'released' || st === 'live') resolvedCount++;

      // Project
      const proj = cr.project || '기타';
      projectCounts[proj] = (projectCounts[proj] || 0) + 1;

      // Customer
      const cust = cr.customer || '공통/미지정';
      customerCounts[cust] = (customerCounts[cust] || 0) + 1;

      // Reporter
      if (cr.reporter) {
        reporterCounts[cr.reporter] = (reporterCounts[cr.reporter] || 0) + 1;
      }

      // Checkin files
      if (cr.files && cr.files.length > 0) {
        withCheckinCount++;
        cr.files.forEach(f => {
          fileCounts[f] = (fileCounts[f] || 0) + 1;
        });
      }

      // Monthly Trend
      if (cr.dateSubmitted && cr.dateSubmitted.length >= 7) {
        const ym = cr.dateSubmitted.substring(0, 7);
        if (!monthlyCounts[ym]) {
          monthlyCounts[ym] = { total: 0, resolved: 0, opened: 0 };
        }
        monthlyCounts[ym].total++;
        if (st === 'resolved' || st === 'validated') monthlyCounts[ym].resolved++;
        if (st === 'opened' || st === 'submitted') monthlyCounts[ym].opened++;
      }
    });

    // Top Status Data
    const statusData = Object.entries(statusCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Top Projects Data
    const projectData = Object.entries(projectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Customer Data
    const customerData = Object.entries(customerCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Monthly Trend Data (Sorted chronological)
    const monthlyData = Object.entries(monthlyCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([month, d]) => ({
        month,
        전체발생: d.total,
        해결완료: d.resolved,
        미해결: d.opened
      }));

    // Top Reporters Data
    const reporterData = Object.entries(reporterCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Top Modified Files
    const topFiles = Object.entries(fileCounts)
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    return {
      total,
      openedCount,
      resolvedCount,
      withCheckinCount,
      activeProjectsCount: Object.keys(projectCounts).length,
      statusData,
      projectData,
      customerData,
      monthlyData,
      reporterData,
      topFiles
    };
  }, [allCrs]);

  const handleFilterProject = (project: string) => {
    onApplyFilter(prev => ({ ...prev, projects: [project] }));
    onSwitchToSearch();
  };

  const handleFilterStatus = (status: string) => {
    onApplyFilter(prev => ({ ...prev, statuses: [status] }));
    onSwitchToSearch();
  };

  const handleFilterFile = (file: string) => {
    onApplyFilter(prev => ({ ...prev, searchQuery: `file:${file}` }));
    onSwitchToSearch();
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      
      {/* 1. Metric Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="glass-card p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>전체 CR 수</span>
            <FolderKanban className="w-4 h-4 text-mantis-400" />
          </div>
          <p className="text-2xl font-black text-white">{stats.total.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500">Mantis 전체 수집 데이터</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>미해결 이슈</span>
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-black text-rose-400">{stats.openedCount.toLocaleString()}</p>
          <p className="text-[11px] text-rose-400/70 font-medium">
            전체의 {((stats.openedCount / (stats.total || 1)) * 100).toFixed(1)}%
          </p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>해결 완료</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-emerald-400">{stats.resolvedCount.toLocaleString()}</p>
          <p className="text-[11px] text-emerald-400/70 font-medium">
            전체의 {((stats.resolvedCount / (stats.total || 1)) * 100).toFixed(1)}%
          </p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>체크인 소스 수정</span>
            <FileCode className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-black text-indigo-300">{stats.withCheckinCount.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500">파일 변경 이력 포함</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>활성 프로젝트</span>
            <Building2 className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-black text-amber-300">{stats.activeProjectsCount}</p>
          <p className="text-[11px] text-slate-500">등록된 총 프로젝트</p>
        </div>
      </div>

      {/* 2. Charts Row 1: Status Distribution & Project Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Status Distribution Pie Chart */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <PieIcon className="w-4 h-4 text-mantis-400" />
            이슈 처리 상태 분포 (Status Breakdown)
          </h3>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {stats.statusData.map((entry) => (
                    <Cell 
                      key={entry.name} 
                      fill={STATUS_COLORS[entry.name] || '#64748b'} 
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => handleFilterStatus(entry.name)}
                    />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`${Number(val).toLocaleString()}건`, '건수']}
                />
                <Legend 
                  layout="horizontal" 
                  verticalAlign="bottom" 
                  align="center"
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Distribution Bar Chart */}
        <div className="lg:col-span-7 glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-blue-400" />
            상위 주요 프로젝트별 CR 분포
          </h3>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.projectData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis 
                  dataKey="name" 
                  stroke="#64748b" 
                  fontSize={11} 
                  angle={-15} 
                  textAnchor="end"
                  interval={0}
                />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`${Number(val).toLocaleString()}건`, 'CR 수']}
                />
                <Bar 
                  dataKey="count" 
                  fill="#22c55e" 
                  radius={[6, 6, 0, 0]}
                  onClick={(entry) => handleFilterProject(entry.name)}
                  className="cursor-pointer hover:opacity-80"
                >
                  {stats.projectData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PROJECT_COLORS[index % PROJECT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* 3. Monthly Timeline Trend Chart */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          최근 월별 CR 발생 및 처리 추이 (Monthly Timeline)
        </h3>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Area type="monotone" dataKey="전체발생" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTotal)" strokeWidth={2} />
              <Area type="monotone" dataKey="해결완료" stroke="#22c55e" fillOpacity={1} fill="url(#colorResolved)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4. Bottom Row: Top Modified Source Files & Top Reporters */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Top 12 Most Frequently Modified Source Files */}
        <div className="lg:col-span-7 glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-indigo-400" />
              가장 빈번하게 수정된 소스 파일 Top 12 (Check-in 기준)
            </h3>
            <span className="text-[10px] text-slate-500">클릭 시 해당 파일 수정 CR 검색</span>
          </div>

          <div className="space-y-1.5">
            {stats.topFiles.map((item, idx) => (
              <div
                key={item.file}
                onClick={() => handleFilterFile(item.file)}
                className="p-2 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 cursor-pointer transition-all flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <span className="font-mono text-xs text-slate-500 w-5 text-center font-bold">
                    #{idx + 1}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors truncate">
                    {item.file}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-28 bg-slate-800 h-2 rounded-full overflow-hidden hidden sm:block">
                    <div 
                      className="bg-indigo-500 h-full rounded-full" 
                      style={{ width: `${Math.min(100, (item.count / (stats.topFiles[0]?.count || 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs font-bold text-mantis-400">
                    {item.count}회
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Active Reporters */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" />
            주요 이슈 보고자 Top 8
          </h3>

          <div className="space-y-2">
            {stats.reporterData.map((r, idx) => (
              <div
                key={r.name}
                onClick={() => {
                  onApplyFilter(prev => ({ ...prev, reporters: [r.name] }));
                  onSwitchToSearch();
                }}
                className="p-2.5 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 cursor-pointer transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-5 text-center text-xs font-bold text-slate-500">#{idx + 1}</span>
                  <span className="text-xs font-semibold text-slate-200">{r.name}</span>
                </div>
                <span className="text-xs font-bold font-mono text-purple-300">{r.count}건</span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
