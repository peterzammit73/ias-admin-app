// Root: src/components/SimpleCharts.jsx
// Version: 1.0 - Lightweight SVG Charts
import React from 'react';

// A lightweight SVG Bar Chart
export const SimpleBarChart = ({ data, height = 200, color = "#4f46e5", labelKey = "label", valueKey = "value" }) => {
    if (!data || data.length === 0) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">No Data</div>;

    const maxValue = Math.max(...data.map(d => d[valueKey] || 0)) || 10;
    const barWidth = 100 / data.length;
    const gap = 2; // %

    return (
        <div className="w-full" style={{ height: `${height}px` }}>
            <div className="h-full flex items-end relative border-b border-gray-200 pb-6">
                {/* Y-Axis Grid Lines */}
                <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
                    {[1, 0.75, 0.5, 0.25, 0].map(pct => (
                        <div key={pct} className="border-t border-gray-100 w-full h-0 relative">
                            <span className="absolute -top-2 -left-8 text-[9px] text-gray-400">
                                {Math.round(maxValue * pct).toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>

                {data.map((item, i) => {
                    const val = item[valueKey] || 0;
                    const hPct = (val / maxValue) * 100;
                    return (
                        <div
                            key={i}
                            className="flex flex-col justify-end items-center relative group"
                            style={{ width: `${barWidth}%`, height: '100%', padding: `0 ${gap / 2}%` }}
                        >
                            <div
                                className="w-full rounded-t transition-all duration-500 hover:opacity-80 relative"
                                style={{ height: `${hPct}%`, backgroundColor: item.color || color }}
                            >
                                {/* Tooltip */}
                                <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                                    {item[labelKey]}: {val.toLocaleString()}
                                </div>
                            </div>
                            <span className="absolute -bottom-6 text-[10px] text-gray-500 truncate w-full text-center px-1">
                                {item[labelKey]}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

// A lightweight SVG Line/Area Chart
export const SimpleLineChart = ({ data, height = 200, color = "#10b981", labelKey = "label", valueKey = "value" }) => {
    if (!data || data.length < 2) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Not enough data</div>;

    const maxValue = Math.max(...data.map(d => d[valueKey] || 0)) * 1.1 || 10;
    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 100 - ((d[valueKey] || 0) / maxValue) * 100;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="w-full relative" style={{ height: `${height}px` }}>
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between border-b border-gray-200 pb-6">
                {[1, 0.5, 0].map(pct => (
                    <div key={pct} className="border-t border-gray-100 w-full h-0 relative">
                        <span className="absolute -top-2 -left-8 text-[9px] text-gray-400">
                            {Math.round(maxValue * pct).toLocaleString()}
                        </span>
                    </div>
                ))}
            </div>

            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-[calc(100%-24px)] overflow-visible">
                <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    points={points}
                    vectorEffect="non-scaling-stroke"
                />
                {/* Dots */}
                {data.map((d, i) => {
                    const x = (i / (data.length - 1)) * 100;
                    const y = 100 - ((d[valueKey] || 0) / maxValue) * 100;
                    return (
                        <circle key={i} cx={x} cy={y} r="3" fill="white" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" className="hover:r-6 transition-all cursor-pointer">
                            <title>{d[labelKey]}: {d[valueKey]}</title>
                        </circle>
                    );
                })}
            </svg>

            <div className="flex justify-between mt-1 text-[10px] text-gray-500">
                <span>{data[0][labelKey]}</span>
                <span>{data[data.length - 1][labelKey]}</span>
            </div>
        </div>
    );
};