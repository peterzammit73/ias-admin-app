// Root: src/modules/billing/MonthlyHoursChart.jsx
// Reverted to v2.8 state (Working Billed vs Unbilled)
import React, { useMemo } from 'react';

const MonthlyHoursChart = ({ stats, selectedYear }) => {
    // Stats are passed directly from the parent (fetched via Cloud Function)
    // Format expected: Array(12) of { billed: number, unbilled: number }
    const chartData = useMemo(() => {
        if (stats && Array.isArray(stats) && stats.length === 12) {
            return stats;
        }
        // Fallback to empty data if stats not yet loaded or invalid
        return Array(12).fill(0).map(() => ({ billed: 0, unbilled: 0 }));
    }, [stats]);

    const maxHours = useMemo(() => {
        const max = Math.max(...chartData.map(d => Math.max(d.billed, d.unbilled)));
        return max > 0 ? max : 10; 
    }, [chartData]);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return (
        <div className="w-full h-full flex flex-col min-h-[250px]">
            <div className="flex items-end justify-between h-64 gap-2 sm:gap-4 flex-1">
                {chartData.map((data, index) => {
                    const billedHeight = maxHours > 0 ? `${(data.billed / maxHours) * 100}%` : '0%';
                    const unbilledHeight = maxHours > 0 ? `${(data.unbilled / maxHours) * 100}%` : '0%';

                    return (
                        <div key={index} className="flex flex-col items-center flex-1 h-full group relative">
                            {/* Bars Container */}
                            <div className="flex items-end justify-center w-full h-full gap-1 border-b border-gray-300 pb-2">
                                {/* Unbilled Bar (Orange) */}
                                <div 
                                    className="w-3 sm:w-4 bg-orange-500 rounded-t-sm transition-all duration-500 relative"
                                    style={{ height: unbilledHeight }}
                                >
                                    {data.unbilled > 0 && (
                                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10 shadow-md">
                                            Unbilled: {data.unbilled.toFixed(1)}h
                                        </div>
                                    )}
                                </div>
                                {/* Billed Bar (Blue) */}
                                <div 
                                    className="w-3 sm:w-4 bg-blue-600 rounded-t-sm transition-all duration-500 relative"
                                    style={{ height: billedHeight }}
                                >
                                    {data.billed > 0 && (
                                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10 shadow-md">
                                            Billed: {data.billed.toFixed(1)}h
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Month Label */}
                            <span className="text-xs text-gray-500 mt-2 font-medium">{months[index]}</span>
                        </div>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="flex justify-center gap-6 mt-6">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-orange-500 rounded-sm"></span>
                    <span className="text-sm text-gray-600">Unbilled Hours</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-blue-600 rounded-sm"></span>
                    <span className="text-sm text-gray-600">Billed Hours</span>
                </div>
            </div>
        </div>
    );
};

export default MonthlyHoursChart;