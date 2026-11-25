import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface ReportConfig {
    type: 'bar' | 'line' | 'scatter';
    metrics: string[];
    timeframe: '1h' | '24h' | '7d';
}

interface EngineProps {
    config?: ReportConfig;
    onRenderComplete?: () => void;
    onRenderError?: (err: Error) => void;
}

class ReportingEngineErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
    constructor(props: {children: React.ReactNode}) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("D3 Reporting Engine Failed:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-6 border border-red-200 rounded-lg bg-red-50 text-red-700">
                    <h4 className="font-semibold mb-2">Reporting Engine Error</h4>
                    <p className="text-sm font-mono">{this.state.error?.message}</p>
                    <button 
                        className="mt-4 px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm transition-colors"
                        onClick={() => this.setState({hasError: false, error: null})}
                    >
                        Retry Render
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const EngineCore: React.FC<EngineProps> = ({ 
    config = { type: 'bar', metrics: ['tx_volume'], timeframe: '24h' },
    onRenderComplete,
    onRenderError
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isRendering, setIsRendering] = useState(true);

    useEffect(() => {
        let isMounted = true;
        setIsRendering(true);

        const renderChart = async () => {
            try {
                if (!containerRef.current) return;
                
                // Simulate data fetching pipeline integration
                const mockData = Array.from({ length: 24 }).map((_, i) => ({
                    hour: i,
                    value: Math.floor(Math.random() * 1000) + 500
                }));

                const width = containerRef.current.clientWidth || 600;
                const height = 400;
                const margin = { top: 20, right: 30, bottom: 40, left: 40 };

                const svg = d3.select(containerRef.current)
                    .selectAll('svg')
                    .data([null])
                    .join('svg')
                    .attr("viewBox", `0 0 ${width} ${height}`)
                    .attr("width", "100%")
                    .attr("height", height);

                svg.selectAll('*').remove(); // Clean slate for idempotent renders

                const x = d3.scaleBand()
                    .domain(mockData.map(d => d.hour.toString()))
                    .range([margin.left, width - margin.right])
                    .padding(0.1);

                const y = d3.scaleLinear()
                    .domain([0, d3.max(mockData, d => d.value) as number]).nice()
                    .range([height - margin.bottom, margin.top]);

                // Render axes
                svg.append("g")
                    .attr("transform", `translate(0,${height - margin.bottom})`)
                    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => !(i % 3))))
                    .attr("color", "#64748b");

                svg.append("g")
                    .attr("transform", `translate(${margin.left},0)`)
                    .call(d3.axisLeft(y).ticks(5))
                    .attr("color", "#64748b");

                // Render Data based on config
                if (config.type === 'bar') {
                    svg.append("g")
                        .attr("fill", "currentColor")
                        .attr("class", "text-blue-500 hover:text-blue-600 transition-colors duration-200")
                        .selectAll("rect")
                        .data(mockData)
                        .join("rect")
                        .attr("x", d => x(d.hour.toString()) as number)
                        .attr("y", d => y(d.value))
                        .attr("height", d => y(0) - y(d.value))
                        .attr("width", x.bandwidth());
                }

                if (isMounted) {
                    setIsRendering(false);
                    onRenderComplete?.();
                }

            } catch (err) {
                console.error("Chart Rendering Pipeline Error:", err);
                if (isMounted) setIsRendering(false);
                onRenderError?.(err instanceof Error ? err : new Error(String(err)));
                throw err; // Trigger ErrorBoundary
            }
        };

        // Render request animation frame to ensure DOM is ready
        requestAnimationFrame(renderChart);

        return () => { isMounted = false; };
    }, [config, onRenderComplete, onRenderError]);

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 w-full relative">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Dynamic Reporting View</h3>
                <div className="flex gap-2">
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-medium capitalize">{config.type}</span>
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-medium">{config.timeframe}</span>
                </div>
            </div>
            
            {isRendering && (
                <div className="absolute inset-0 z-10 bg-white/80 flex items-center justify-center rounded-xl">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
            )}
            
            <div ref={containerRef} className="w-full min-h-[400px] transition-opacity duration-300" style={{ opacity: isRendering ? 0.5 : 1 }}></div>
        </div>
    );
};

export const CustomizableD3ReportingEngine: React.FC<EngineProps> = (props) => (
    <ReportingEngineErrorBoundary>
        <EngineCore {...props} />
    </ReportingEngineErrorBoundary>
);
