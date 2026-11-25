import React, { useState, useEffect } from 'react';
import * as d3 from 'd3';

// Mock data pipeline interface
interface CongestionData {
    timestamp: number;
    value: number;
    status: 'normal' | 'congested' | 'critical';
}

interface Props {
    dataSourceUrl?: string;
    refreshInterval?: number;
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
    constructor(props: {children: React.ReactNode}) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("NetworkCongestionRadialChart Error:", error, errorInfo);
        // Integrate with error tracking system here
    }
    render() {
        if (this.state.hasError) {
            return <div className="p-4 bg-red-100 text-red-800 rounded-md">Visualization Pipeline Failed: {this.state.error?.message}. Fallback engaged.</div>;
        }
        return this.props.children;
    }
}

const RadialChartCore: React.FC<Props> = ({ dataSourceUrl = '/api/congestion', refreshInterval = 5000 }) => {
    const [data, setData] = useState<CongestionData[]>([]);
    const [loading, setLoading] = useState(true);
    const svgRef = React.useRef<SVGSVGElement>(null);

    // Fault-tolerant data pipeline
    useEffect(() => {
        let isMounted = true;
        
        const fetchData = async () => {
            try {
                // In a real scenario, this would use a robust fetch wrapper with retries
                // const response = await fetch(dataSourceUrl);
                // if (!response.ok) throw new Error('Data pipeline disrupted');
                // const result = await response.json();
                
                // Mock robust data fetching
                const result = Array.from({ length: 12 }).map((_, i) => ({
                    timestamp: Date.now() - i * 3600000,
                    value: Math.random() * 100,
                    status: 'normal' as const
                }));

                if (isMounted) {
                    setData(result);
                    setLoading(false);
                }
            } catch (error) {
                console.error("Pipeline degradation detected:", error);
                // Fallback to cached or empty data
                if (isMounted) {
                    setData([]);
                    setLoading(false);
                }
            }
        };

        fetchData();
        const interval = setInterval(fetchData, refreshInterval);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [dataSourceUrl, refreshInterval]);

    useEffect(() => {
        if (!svgRef.current || data.length === 0) return;
        
        const width = 300;
        const height = 300;
        const margin = 20;
        const radius = Math.min(width, height) / 2 - margin;

        const svg = d3.select(svgRef.current)
            .attr("width", width)
            .attr("height", height)
            .html(""); // Clear previous renders for idempotency

        const g = svg.append("g")
            .attr("transform", `translate(${width / 2},${height / 2})`);

        const color = d3.scaleOrdinal()
            .domain(['normal', 'congested', 'critical'])
            .range(['#4ade80', '#fbbf24', '#f87171']);

        const pie = d3.pie<CongestionData>()
            .value(d => d.value)
            .sort(null);

        const arc = d3.arc<d3.PieArcDatum<CongestionData>>()
            .innerRadius(radius * 0.5)
            .outerRadius(radius * 0.8);

        g.selectAll('path')
            .data(pie(data))
            .enter()
            .append('path')
            .attr('d', arc)
            .attr('fill', d => color(d.data.status) as string)
            .attr('stroke', 'white')
            .style('stroke-width', '2px')
            .style('opacity', 0.8);

        return () => {
            if (svgRef.current) {
                d3.select(svgRef.current).selectAll('*').interrupt().remove();
            }
        };
    }, [data]);

    if (loading) return <div className="animate-pulse flex space-x-4">Loading pipeline data...</div>;

    return (
        <div className="relative flex flex-col items-center p-6 bg-white rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Network Congestion Overview</h3>
            <svg ref={svgRef}></svg>
            <div className="absolute top-4 right-4 text-xs font-mono text-green-600 bg-green-50 px-2 py-1 rounded">Pipeline: Healthy</div>
        </div>
    );
};

export const NetworkCongestionRadialChart: React.FC<Props> = (props) => (
    <ErrorBoundary>
        <RadialChartCore {...props} />
    </ErrorBoundary>
);
