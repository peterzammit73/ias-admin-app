// Root: src/components/MultiYearBarChart.jsx
import React from 'react';

const MultiYearBarChart = ({ data, keys, colors, height = 300, currency = "€" }) => {
    // data: Array of 12 objects (months), e.g., [{ month: 'Jan', '2023': 100, '2024': 150 }, ...]
    // keys: Array of years to display keys=['2023', '2024']
    // colors: Object mapping keys to colors { '2023': '#ccc', '2024': '#f00' }

    if (!data || data.length === 0) return <div className="flex h-full items-center justify-center text-gray-400">No data available</div>;

    // Calculate Max Value for Scaling
    const allValues = data.flatMap(d => keys.map(k => d[k] || 0));
    const maxValue = Math.max(...allValues) * 1.1 || 1000; // Add 10% headroom

    const padding = 40; // Left padding for axis labels
    const bottomPadding = 30;
    const chartHeight = height - bottomPadding;
    const chartWidth = 100; // Percent based width logic doesn't work well with exact SVG pixels, so we use percentages for positioning relative to container

    const formatVal = (val) => {
        if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
        return val;
    };

    return (
        <div className="w-full relative select-none" style={{ height: `${height}px` }}>
            {/* Y-Axis Labels & Grid */}
            <div className="absolute top-0 left-0 bottom-8 w-10 flex flex-col justify-between text-[10px] text-gray-400 text-right pr-2">
                <span>{formatVal(maxValue)}</span>
                <span>{formatVal(maxValue * 0.75)}</span>
                <span>{formatVal(maxValue * 0.5)}</span>
                <span>{formatVal(maxValue * 0.25)}</span>
                <span>0</span>
            </div>

            {/* Grid Lines */}
            <div className="absolute top-0 left-10 right-0 bottom-8 flex flex-col justify-between pointer-events-none">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="border-t border-gray-100 w-full h-0"></div>
                ))}
            </div>

            {/* Bars Area */}
            <div className="absolute top-0 left-10 right-0 bottom-0 flex justify-between items-end pb-8 pl-2 pr-2">
                {data.map((item, i) => (
                    <div key={i} className="flex-1 flex justify-center items-end h-full gap-[2px] group relative">
                        {keys.map((key) => {
                            const val = item[key] || 0;
                            const barHeight = (val / maxValue) * 100;
                            return (
                                <div
                                    key={key}
                                    className="w-2 sm:w-3 md:w-4 rounded-t-sm transition-all duration-500 hover:opacity-80 relative"
                                    style={{
                                        height: `${Math.max(barHeight, 0)}%`,
                                        backgroundColor: colors[key] || '#ccc'
                                    }}
                                >
                                    {/* Tooltip */}
                                    <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-20 pointer-events-none">
                                        <div className="bg-gray-900 text-white text-[10px] py-1 px-2 rounded shadow-lg whitespace-nowrap">
                                            <span className="font-bold block text-gray-300">{key}</span>
                                            {currency}{val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {/* X-Axis Label */}
                        <div className="absolute -bottom-6 text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                            {item.month}
                        </div>
                        {/* Vertical Hover Guide */}
                        <div className="absolute inset-y-0 w-full bg-gray-50 opacity-0 group-hover:opacity-100 -z-10 transition-opacity rounded-md"></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MultiYearBarChart;