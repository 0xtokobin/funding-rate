import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { io } from 'socket.io-client';

// 添加防抖函数
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// 添加清算风险计算函数
const calculateLiquidationRisk = (leverage, rateDiff) => {
  // 简单的清算风险评估
  if (leverage <= 1) return "低";
  if (leverage <= 3) return rateDiff > 0.1 ? "中" : "低";
  if (leverage <= 5) return rateDiff > 0.05 ? "高" : "中";
  return "极高";
};

export default function Home() {
  // 状态管理
  const [fundingRates, setFundingRates] = useState([]); // 原始资金费率数据
  const [groupedRates, setGroupedRates] = useState({}); // 按币种分组的资金费率
  const [exchanges, setExchanges] = useState([]); // 交易所列表
  const [isLoading, setIsLoading] = useState(true); // 加载状态
  const [sortConfig, setSortConfig] = useState({ key: 'symbol', direction: 'asc' }); // 币种排序配置
  const [exchangeSort, setExchangeSort] = useState({ exchange: null, direction: 'desc' }); // 交易所排序配置
  const [hourlyExchanges, setHourlyExchanges] = useState(new Set(['HyperLiquid'])); // 1小时结算的交易所集合
  const [isDarkMode, setIsDarkMode] = useState(false); // 深色模式状态
  const [mounted, setMounted] = useState(false); // 组件挂载状态，用于解决 SSR 问题
  const [isUpdating, setIsUpdating] = useState(false); // 添加更新状态
  const [showInterval, setShowInterval] = useState(false); // 添加显示模式状态
  const [showNormalized, setShowNormalized] = useState(false); // 添加标准化显示状态
  const [selectedExchanges, setSelectedExchanges] = useState(new Set(['Binance', 'Bybit', 'OKX', 'Bitget', 'HyperLiquid', 'Gate']));
  const allExchanges = [
    { id: 'Binance', order: 1 },
    { id: 'Bybit', order: 2 },
    { id: 'Bitget', order: 3 },
    { id: 'OKX', order: 4 },
    { id: 'HyperLiquid', order: 5 },
    { id: 'Gate', order: 6 }
  ];
  const [searchTerm, setSearchTerm] = useState('');  // 新增搜索状态
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState([]);
  const [showArbitrageTable, setShowArbitrageTable] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  
  // Socket.IO状态
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [error, setError] = useState(null);
  const maxReconnectAttempts = 5;

  // 添加防抖处理的参数更新函数
  const debouncedParamsChange = useCallback(
    debounce((newParams) => {
      setCalculatorParams(newParams);
    }, 300),
    []
  );

  // 将计算逻辑抽离为独立函数
  const calculateNetReturn = useCallback((opportunity, params) => {
    if (!opportunity) return null;
    
    const longRate = parseFloat(opportunity.longRate);
    const shortRate = parseFloat(opportunity.shortRate);
    const rateDiff = Math.abs(longRate - shortRate);
    
    // 计算交易成本
    const totalFee = params.position * params.tradingFee * 4;
    const slippageCost = params.position * params.slippage * 4;
    
    // 计算借币成本
    const isPositiveFunding = longRate > 0 || shortRate > 0;
    const borrowCost = isPositiveFunding ? 
      (params.position * params.borrowRate) : 0;
    
    const totalCost = totalFee + slippageCost + borrowCost;
    
    // 计算收益
    const dailyReturn = (params.position * rateDiff * 0.01 * params.leverage) / 100;
    const netDailyReturn = dailyReturn - totalCost;
    const netAnnualReturn = netDailyReturn * 365;
    const netAnnualYield = (netAnnualReturn / params.position) * 100;
    
    // 计算清算风险
    const liquidationRisk = calculateLiquidationRisk(params.leverage, rateDiff);
    
    // 计算所需保证金
    const requiredMargin = params.position * params.marginRatio;
    
    // 计算ROE
    const dailyROE = (netDailyReturn / requiredMargin) * 100;
    const annualROE = dailyROE * 365;
    
    return {
      netDailyReturn,
      netAnnualYield,
      totalCost,
      borrowCost,
      liquidationRisk,
      requiredMargin,
      dailyROE,
      annualROE,
      isPositiveFunding
    };
  }, []);

  // 初始化主题设置
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark');
      } else {
        setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    }
  }, []);

  // 监听深色模式变化，更新 HTML class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  // 初始化Socket.IO连接
  useEffect(() => {
    let socketInstance = null;
    
    const initSocket = async () => {
      try {
        // 首先确保socket端点可用
        console.log('尝试连接Socket.IO...');
        await fetch('/api/socket');
        
        // 使用明确的配置创建Socket.IO客户端
        socketInstance = io(undefined, {
          path: '/api/socket',
          transports: ['polling', 'websocket'],
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000
        });
        
        socketInstance.on('connect', () => {
          console.log('Socket.IO已连接，ID:', socketInstance.id);
          setIsConnected(true);
          setConnectionAttempts(0);
          setError(null);
          
          // 连接成功后请求数据
          socketInstance.emit('get-funding-rates');
        });
        
        socketInstance.on('connected', (data) => {
          console.log('收到连接确认:', data);
          if (data.timestamp) {
            setLastUpdate(new Date(data.timestamp).toLocaleTimeString());
          }
        });
        
        // 监听两种可能的事件名
        const handleDataUpdate = (data) => {
          console.log('收到资金费率数据更新，记录数:', data.data?.length || 0);
          
          if (data && data.data && Array.isArray(data.data)) {
            setFundingRates(data.data.filter(rate => selectedExchanges.has(rate.exchange)));
            
            // 按币种分组
            const grouped = data.data
              .filter(rate => selectedExchanges.has(rate.exchange))
              .reduce((acc, rate) => {
                if (!acc[rate.symbol]) {
                  acc[rate.symbol] = {};
                }
                acc[rate.symbol][rate.exchange] = rate;
                return acc;
              }, {});
            
            setGroupedRates(grouped);
            
            // 设置 1 小时结算的交易所
            const hourlySet = new Set(['HyperLiquid']);
            if (data.data.some(rate => rate.exchange === 'Bybit' && rate.isHourly)) {
              hourlySet.add('Bybit');
            }
            setHourlyExchanges(hourlySet);
            
            // 设置套利机会
            if (data.arbitrageOpportunities) {
              setArbitrageOpportunities(data.arbitrageOpportunities);
            }
            
            // 更新时间戳
            setLastUpdate(data.lastUpdate ? 
              new Date(data.lastUpdate).toLocaleTimeString() : 
              new Date().toLocaleTimeString());
            
            setIsUpdating(true);
            setTimeout(() => setIsUpdating(false), 1000);
            setIsLoading(false);
          }
        };

        // 监听funding-rates事件
        socketInstance.on('funding-rates', handleDataUpdate);
        
        // 也监听funding-rates-update事件（旧的事件名）
        socketInstance.on('funding-rates-update', handleDataUpdate);
        
        socketInstance.on('disconnect', () => {
          console.log('Socket.IO连接断开');
          setIsConnected(false);
        });
        
        socketInstance.on('connect_error', (err) => {
          console.error('Socket.IO连接错误:', err.message);
          setConnectionAttempts(prev => prev + 1);
          
          if (connectionAttempts >= maxReconnectAttempts) {
            setError('网络连接不稳定，请刷新页面重试');
          }
        });
        
        socketInstance.on('error', (error) => {
          console.error('Socket.IO错误:', error);
          setError(`服务器错误: ${error.message || '未知错误'}`);
        });
        
        setSocket(socketInstance);
      } catch (err) {
        console.error('初始化Socket.IO失败:', err);
        setError('无法连接到服务器，请刷新页面重试');
        // 失败后尝试传统的API获取数据
        fetchDataDirectly();
      }
    };
    
    // 传统API获取数据的函数
    const fetchDataDirectly = async () => {
      try {
        console.log('使用传统API获取数据...');
        const response = await fetch('/api/funding-rates');
        const data = await response.json();
        
        if (data.success && Array.isArray(data.data)) {
          setFundingRates(data.data.filter(rate => selectedExchanges.has(rate.exchange)));
          
          // 处理数据...（同上）
          const grouped = data.data
            .filter(rate => selectedExchanges.has(rate.exchange))
            .reduce((acc, rate) => {
              if (!acc[rate.symbol]) {
                acc[rate.symbol] = {};
              }
              acc[rate.symbol][rate.exchange] = rate;
              return acc;
            }, {});
          
          setGroupedRates(grouped);
          
          const hourlySet = new Set(['HyperLiquid']);
          if (data.data.some(rate => rate.exchange === 'Bybit' && rate.isHourly)) {
            hourlySet.add('Bybit');
          }
          setHourlyExchanges(hourlySet);
          
          if (data.arbitrageOpportunities) {
            setArbitrageOpportunities(data.arbitrageOpportunities);
          }
          
          setLastUpdate(new Date().toLocaleTimeString());
          setIsLoading(false);
        }
      } catch (error) {
        console.error('传统API获取数据错误:', error);
        setError('获取数据失败，请刷新页面重试');
      }
    };
    
    initSocket();
    
    // 创建简单的手动刷新函数并绑定到window对象
    window.refreshFundingRates = () => {
      if (socketInstance && socketInstance.connected) {
        console.log('手动请求数据更新...');
        socketInstance.emit('get-funding-rates');
        return true;
      } else {
        console.log('Socket未连接，使用传统API获取数据...');
        fetchDataDirectly();
        return false;
      }
    };
    
    // 设置定时刷新
    const interval = setInterval(() => {
      if (socketInstance && socketInstance.connected) {
        console.log('发送定时数据请求...');
        socketInstance.emit('get-funding-rates');
      } else {
        // 如果Socket没有连接，使用传统API
        fetchDataDirectly();
      }
    }, 30000); // 每30秒更新一次
    
    // 清理函数
    return () => {
      clearInterval(interval);
      delete window.refreshFundingRates;
      if (socketInstance) {
        console.log('关闭Socket.IO连接');
        socketInstance.disconnect();
      }
    };
  }, []);

  // 处理币种排序
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
    setExchangeSort({ exchange: null, direction: 'desc' });
  };

  // 处理交易所排序
  const handleExchangeSort = (exchange) => {
    setExchangeSort(prev => ({
      exchange,
      direction: prev.exchange === exchange && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
    setSortConfig({ key: null, direction: null });
  };

  // 排序逻辑
  const sortedSymbols = Object.keys(groupedRates).sort((a, b) => {
    // 检查是否有数据
    const aHasData = exchangeSort.exchange ? 
      !!groupedRates[a][exchangeSort.exchange] : 
      exchanges.some(e => !!groupedRates[a][e]);
    
    const bHasData = exchangeSort.exchange ? 
      !!groupedRates[b][exchangeSort.exchange] : 
      exchanges.some(e => !!groupedRates[b][e]);

    // 有数据的排在前面
    if (aHasData !== bHasData) {
      return aHasData ? -1 : 1;
    }

    // 按币种或费率排序
    if (sortConfig.key === 'symbol') {
      return sortConfig.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    } else if (exchangeSort.exchange) {
      const aData = groupedRates[a][exchangeSort.exchange];
      const bData = groupedRates[b][exchangeSort.exchange];
      
      // 获取费率（考虑标准化显示）
      const getRate = (data) => {
        if (!data) return -999;
        const baseRate = parseFloat(data.currentRate);
        if (showNormalized && data.settlementInterval && data.settlementInterval !== 8) {
          return baseRate * (8 / data.settlementInterval);
        }
        return baseRate;
      };

      const aRate = getRate(aData);
      const bRate = getRate(bData);

      return exchangeSort.direction === 'asc' ? 
        aRate - bRate : 
        bRate - aRate;
    }
    return 0;
  });

  // 切换主题
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  // 处理交易所选择
  const handleExchangeToggle = (exchangeId) => {
    setSelectedExchanges(prev => {
      const newSet = new Set(prev);
      if (newSet.has(exchangeId)) {
        newSet.delete(exchangeId);
      } else {
        newSet.add(exchangeId);
      }
      return newSet;
    });
  };

  // 在 useEffect 中更新 exchanges，保持顺序
  useEffect(() => {
    const sortedExchanges = allExchanges
      .filter(exchange => selectedExchanges.has(exchange.id))
      .sort((a, b) => a.order - b.order)
      .map(exchange => exchange.id);
    setExchanges(sortedExchanges);
  }, [selectedExchanges]);

  // 新增搜索过滤函数
  const filterData = (data) => {
    if (!searchTerm) return data;
    
    const searchLower = searchTerm.toLowerCase();
    return data.filter(item => {
      // 搜索币种名称
      if (item.symbol.toLowerCase().includes(searchLower)) return true;
      
      // 搜索费率值
      for (const exchange of exchanges) {
        const rate = item.rates[exchange]?.rate;
        if (rate && rate.toString().includes(searchLower)) return true;
      }
      
      return false;
    });
  };

  // 修改套利机会表格渲染函数
  const renderArbitrageTable = () => {
    if (!arbitrageOpportunities || arbitrageOpportunities.length === 0) {
      return <div className="text-center mt-4 text-gray-500">暂无套利机会</div>;
    }

    const differentPeriodOpps = arbitrageOpportunities
      .filter(opp => opp.type === 'different_period' && parseFloat(opp.expectedProfit) >= 0.3)
      .sort((a, b) => parseFloat(b.expectedProfit) - parseFloat(a.expectedProfit));

    const samePeriodOpps = arbitrageOpportunities
      .filter(opp => opp.type === 'same_period' && parseFloat(opp.expectedProfit) >= 0.3)
      .sort((a, b) => parseFloat(b.expectedProfit) - parseFloat(a.expectedProfit));

    return (
      <div className="mt-8">
        {/* 跨周期套利机会 */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">跨周期套利机会</h2>
          <p className="text-sm text-gray-500 mb-4">
            策略说明：利用不同交易所结算周期差异，在短周期交易所做多（负费率），长周期交易所做空（暂不付费）<br/>
            <span className="text-xs">注：仅显示预期收益 ≥ 0.3% 的机会</span>
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-center whitespace-nowrap">交易对</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做多交易所<br/>(短周期)</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做空交易所<br/>(长周期)</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做多费率<br/>(负费率)</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做空费率<br/>(参考)</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">结算周期<br/>(短/长)</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">预期收益</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">年化收益</th>
                </tr>
              </thead>
              <tbody>
                {differentPeriodOpps.map((opp, index) => (
                  <tr key={index} className="hover:bg-gray-900">
                    <td className="px-4 py-2 text-center">{opp.symbol}</td>
                    <td className="px-4 py-2 text-center">{opp.longExchange}</td>
                    <td className="px-4 py-2 text-center">{opp.shortExchange}</td>
                    <td className="px-4 py-2 text-center text-green-500">{parseFloat(opp.longRate).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center text-gray-400">{parseFloat(opp.shortRate).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center whitespace-nowrap">{opp.settlementPeriod1}h/{opp.settlementPeriod2}h</td>
                    <td className="px-4 py-2 text-center text-yellow-400">{parseFloat(opp.expectedProfit).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center text-yellow-400">{parseFloat(opp.annualYield).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {differentPeriodOpps.length > 0 ? (
              <div className="text-center mt-2 text-gray-400">
                共找到 {differentPeriodOpps.length} 个跨周期套利机会
              </div>
            ) : (
              <div className="text-center mt-2 text-gray-400">
                暂无满足条件的跨周期套利机会
              </div>
            )}
          </div>
        </div>

        {/* 同周期套利机会 */}
        <div className="mt-12">
          <h2 className="text-xl font-bold mb-4">同周期套利机会</h2>
          <p className="text-sm text-gray-500 mb-4">
            策略说明：利用相同结算周期内不同交易所的费率差进行套利<br/>
            <span className="text-xs">注：仅显示预期收益 ≥ 0.3% 的机会</span>
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-center whitespace-nowrap">交易对</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做多交易所</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做空交易所</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做多费率</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">做空费率</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">费率差</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">结算周期</th>
                  <th className="px-4 py-2 text-center whitespace-nowrap">年化收益</th>
                </tr>
              </thead>
              <tbody>
                {samePeriodOpps.map((opp, index) => (
                  <tr key={index} className="hover:bg-gray-900">
                    <td className="px-4 py-2 text-center">{opp.symbol}</td>
                    <td className="px-4 py-2 text-center">{opp.longExchange}</td>
                    <td className="px-4 py-2 text-center">{opp.shortExchange}</td>
                    <td className="px-4 py-2 text-center text-green-500">{parseFloat(opp.longRate).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center text-red-500">{parseFloat(opp.shortRate).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center">{parseFloat(opp.rateDiff).toFixed(4)}%</td>
                    <td className="px-4 py-2 text-center">{opp.settlementPeriod}h</td>
                    <td className="px-4 py-2 text-center text-yellow-400">{parseFloat(opp.annualYield).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {samePeriodOpps.length > 0 ? (
              <div className="text-center mt-2 text-gray-400">
                共找到 {samePeriodOpps.length} 个同周期套利机会
              </div>
            ) : (
              <div className="text-center mt-2 text-gray-400">
                暂无满足条件的同周期套利机会
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 强制刷新套利机会数据
  const forceRefreshArbitrageData = () => {
    console.log('强制刷新套利机会数据...');
    setIsLoading(true);
    
    fetch('/api/funding-rates')
      .then(response => response.json())
      .then(data => {
        console.log('接收到API数据:', data);
        
        if (data.arbitrageOpportunities) {
          console.log('套利机会数据:', data.arbitrageOpportunities);
          
          // 设置套利机会数据
          setArbitrageOpportunities(data.arbitrageOpportunities || []);
          
          // 手动设置显示套利表格
          setShowArbitrageTable(true);
        } else {
          console.error('API返回的数据没有套利机会信息');
        }
      })
      .catch(error => {
        console.error('刷新套利数据错误:', error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  // 添加连接状态指示器组件 - 改为仅显示更新时间，不显示连接状态
  const ConnectionStatus = () => (
    <div className="time-status">
      {lastUpdate && (
        <div className="last-update-timestamp">
          最后更新: {lastUpdate}
        </div>
      )}
    </div>
  );

  // 等待客户端渲染
  if (!mounted) return null;

  return (
    <div className={`container ${isDarkMode ? 'dark-mode' : 'light-mode'}`}>
      <Head>
        <title>永续合约资金费率比较</title>
        <meta name="description" content="永续合约资金费率比较" />
      </Head>

      <main>
        <ConnectionStatus />
        <div className="header-container">
          <div className="title-container">
            <h1>永续合约资金费率比较</h1>
          </div>
          <div className="controls-container">
            <div className="search-container">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索币种或费率..."
                className="search-input"
              />
            </div>
            <div className="controls">
              <div className="exchange-dropdown">
                <button className="dropdown-button">
                  交易所选择 ({selectedExchanges.size})
                </button>
                <div className="dropdown-content">
                  {allExchanges.map(exchange => (
                    <label key={exchange.id} className="exchange-option">
                      <input
                        type="checkbox"
                        checked={selectedExchanges.has(exchange.id)}
                        onChange={() => handleExchangeToggle(exchange.id)}
                        disabled={selectedExchanges.size === 1 && selectedExchanges.has(exchange.id)}
                      />
                      {exchange.id}
                    </label>
                  ))}
                </div>
              </div>
              <button 
                onClick={() => setShowInterval(!showInterval)}
                className={`display-toggle ${showInterval ? 'active' : ''}`}
                title={showInterval ? "切换为星号显示" : "切换为小时显示"}
              >
                {showInterval ? "星号" : "小时"}
              </button>
              <button 
                onClick={() => setShowNormalized(!showNormalized)}
                className={`display-toggle ${showNormalized ? 'active' : ''}`}
                title={showNormalized ? "显示当前费率" : "显示8小时费率"}
              >
                {showNormalized ? "当前" : "8 H"}
              </button>
              <button 
                onClick={toggleTheme}
                className="theme-toggle"
                title={isDarkMode ? "切换至浅色模式" : "切换至深色模式"}
              >
                {isDarkMode ? '🌞' : '🌛'}
              </button>
              <button
                onClick={() => setShowArbitrageTable(!showArbitrageTable)}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded transition"
              >
                {showArbitrageTable ? '显示费率表格' : '显示套利机会'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="rates-container">
          {isLoading ? (
            <div className="loading">加载中...</div>
          ) : (
            <>
              {isUpdating && (
                <div className="updating-indicator">
                  更新中...
                </div>
              )}
              {showArbitrageTable ? (
                <div className="arbitrage-tables">
                  <div className="debugging-info mb-4">
                    <button 
                      onClick={forceRefreshArbitrageData}
                      className="px-4 py-2 mr-4 bg-blue-500 hover:bg-blue-700 rounded transition"
                    >
                      强制刷新套利数据
                    </button>
                    <div className="mt-2">
                      <p>套利机会: {arbitrageOpportunities?.length || 0} 条</p>
                    </div>
                  </div>
                  {renderArbitrageTable()}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={isUpdating ? 'updating' : ''}>
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('symbol')} className="sortable">
                          币种 {sortConfig.key === 'symbol' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        {exchanges.map(exchange => (
                          <th 
                            key={exchange} 
                            onClick={() => handleExchangeSort(exchange)} 
                            className="sortable"
                          >
                            {exchange}
                            {hourlyExchanges.has(exchange) && (
                              <span style={{ marginLeft: '4px', color: '#ffd700' }} title="每1小时结算">
                                ★1h
                              </span>
                            )}
                            {exchangeSort.exchange === exchange ? 
                              (exchangeSort.direction === 'asc' ? '↑' : '↓') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filterData(sortedSymbols.map(symbol => ({
                        symbol,
                        rates: groupedRates[symbol]
                      }))).map((item) => (
                        <tr key={item.symbol}>
                          <td>
                            <a
                              href={`/history/${item.symbol}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="symbol-link"
                            >
                              {item.symbol}
                            </a>
                          </td>
                          {exchanges.map(exchange => {
                            const data = item.rates[exchange];
                            return (
                              <td 
                                key={`${item.symbol}-${exchange}`}
                                className={data && parseFloat(data.currentRate) > 0 ? 'positive-rate' : 'negative-rate'}
                                style={{ textAlign: 'center' }}
                              >
                                {data ? (
                                  <>
                                    {showNormalized && data.settlementInterval && data.settlementInterval !== 8 ? (
                                      // 标准化为8小时费率
                                      `${(parseFloat(data.currentRate) * (8 / data.settlementInterval)).toFixed(4)}%`
                                    ) : (
                                      `${parseFloat(data.currentRate)}%`
                                    )}
                                    {data.isSpecialInterval && (
                                      <span 
                                        style={{ color: '#ffd700' }} 
                                        title={`每${data.settlementInterval}小时结算${showNormalized ? ' (已转换为8小时)' : ''}`}
                                      >
                                        {showInterval ? `${data.settlementInterval}H` : '*'}
                                      </span>
                                    )}
                                  </>
                                ) : '-'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <style jsx global>{`
        :root {
          --bg-color: ${isDarkMode ? '#000000' : '#ffffff'};
          --text-color: ${isDarkMode ? '#ffffff' : '#333333'};
          --table-border: ${isDarkMode ? '#333333' : '#e0e0e0'};
          --hover-bg: ${isDarkMode ? '#2a2a2a' : '#f8f8f8'};
          --positive-color: ${isDarkMode ? '#4caf50' : '#00a152'};
          --negative-color: ${isDarkMode ? '#f44336' : '#d32f2f'};
          --header-bg: ${isDarkMode ? '#000000' : '#ffffff'};
          --loading-bg: ${isDarkMode ? '#242424' : '#f8f8f8'};
          --th-bg: ${isDarkMode ? '#000000' : '#f5f5f5'};
          --td-bg: ${isDarkMode ? '#000000' : '#ffffff'};
        }

        body {
          background-color: var(--bg-color);
          color: var(--text-color);
          transition: background-color 0.3s, color 0.3s;
          margin: 0;
          padding: 0;
        }

        .container {
          min-height: 100vh;
          padding: 20px;
          background-color: var(--bg-color);
        }

        .header-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          margin-bottom: 20px;
          width: 100%;
        }

        .title-container {
          text-align: center;
        }

        .controls-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
          width: 100%;
        }

        .search-container {
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
        }

        .search-input {
          width: 100%;
          padding: 10px 15px;
          border: 2px solid var(--table-border);
          border-radius: 6px;
          background: var(--bg-color);
          color: var(--text-color);
          font-size: 16px;
          outline: none;
          transition: all 0.3s ease;
        }

        .search-input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
        }

        .search-input::placeholder {
          color: var(--text-color);
          opacity: 0.6;
        }

        .controls {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
        }

        .exchange-dropdown {
          position: relative;
          display: inline-block;
        }

        .dropdown-button {
          padding: 5px 10px;
          border: 1px solid var(--table-border);
          border-radius: 4px;
          background: var(--bg-color);
          color: var(--text-color);
          cursor: pointer;
          min-width: 120px;
        }

        .dropdown-content {
          display: none;
          position: absolute;
          right: 0;
          background-color: var(--bg-color);
          min-width: 160px;
          box-shadow: 0 8px 16px rgba(0,0,0,0.2);
          padding: 8px;
          border-radius: 4px;
          border: 1px solid var(--table-border);
          z-index: 1;
        }

        .exchange-dropdown:hover .dropdown-content {
          display: block;
        }

        .exchange-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          cursor: pointer;
          white-space: nowrap;
        }

        .exchange-option:hover {
          background-color: var(--hover-bg);
        }

        .exchange-option input {
          cursor: pointer;
        }

        .exchange-option input:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .display-toggle {
          padding: 5px 10px;
          border: 1px solid var(--table-border);
          border-radius: 4px;
          background: var(--bg-color);
          cursor: pointer;
          color: var(--text-color);
          transition: all 0.3s ease;
          min-width: 56px;
          text-align: center;
          display: inline-block;
          font-size: 14px;
          line-height: 1.5;
        }

        .display-toggle:hover {
          background: var(--hover-bg);
        }

        .display-toggle.active {
          background: var(--text-color);
          color: var(--bg-color);
          border-color: var(--text-color);
        }

        /* 深色模式适配 */
        :global(.dark-mode) .display-toggle.active {
          background: var(--text-color);
          color: var(--bg-color);
        }

        .theme-toggle {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 8px;
          border-radius: 50%;
          transition: background-color 0.3s;
          color: var(--text-color);
        }

        .theme-toggle:hover {
          background-color: var(--hover-bg);
        }

        .loading {
          padding: 20px;
          text-align: center;
          background-color: var(--loading-bg);
          border-radius: 8px;
          color: var(--text-color);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          background-color: var(--bg-color) !important;
          border: 1px solid var(--table-border);
        }

        th, td {
          padding: 12px;
          text-align: center !important;
          border: 1px solid var(--table-border);
          color: var(--text-color);
          background-color: var(--bg-color);
        }

        th {
          font-weight: bold;
          background-color: ${isDarkMode ? '#1a1a1a' : '#f5f5f5'} !important;
          color: ${isDarkMode ? '#ffffff' : '#333333'} !important;
          border-bottom: 2px solid var(--table-border);
        }

        td:first-child {
          text-align: center !important;
          font-weight: normal;
          background-color: var(--bg-color) !important;
          color: var(--text-color) !important;
        }

        .symbol-link {
          color: var(--text-color) !important;
          text-decoration: none;
          cursor: pointer;
          transition: opacity 0.3s;
          font-weight: normal;
          display: block;
          padding: 4px;
        }

        .symbol-link:hover {
          opacity: 0.8;
          text-decoration: underline;
          background-color: var(--hover-bg);
        }

        .positive-rate {
          color: ${isDarkMode ? 'rgb(0, 255, 0)' : '#00a152'} !important;
          font-weight: bold;
        }

        .negative-rate {
          color: ${isDarkMode ? 'rgb(255, 0, 0)' : '#d32f2f'} !important;
          font-weight: bold;
        }

        tr:hover td {
          background-color: ${isDarkMode ? '#2a2a2a' : '#f8f8f8'} !important;
        }

        tr:hover td:first-child {
          background-color: ${isDarkMode ? '#333333' : '#f0f0f0'} !important;
        }

        .sortable {
          cursor: pointer;
          user-select: none;
        }

        .sortable:hover {
          background-color: var(--hover-bg);
        }

        h1 {
          margin: 0;
          color: var(--text-color);
        }

        .dark-mode {
          background-color: var(--bg-color) !important;
        }

        .updating-indicator {
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 8px 16px;
          background-color: var(--header-bg);
          border-radius: 4px;
          opacity: 0.8;
          transition: opacity 0.3s;
        }

        .updating {
          transition: opacity 0.3s;
        }

        /* 数据变化时的过渡效果 */
        td {
          transition: background-color 0.3s, color 0.3s;
        }

        .positive-rate, .negative-rate {
          transition: color 0.3s;
        }

        /* 确保更新时不会有跳动 */
        table {
          table-layout: fixed;
          width: 100%;
        }

        td, th {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .exchange-dropdown {
          position: relative;
          display: inline-block;
        }

        .dropdown-button {
          padding: 5px 10px;
          border: 1px solid var(--table-border);
          border-radius: 4px;
          background: var(--bg-color);
          color: var(--text-color);
          cursor: pointer;
          min-width: 120px;
        }

        .dropdown-content {
          display: none;
          position: absolute;
          right: 0;
          background-color: var(--bg-color);
          min-width: 160px;
          box-shadow: 0 8px 16px rgba(0,0,0,0.2);
          padding: 8px;
          border-radius: 4px;
          border: 1px solid var(--table-border);
          z-index: 1;
        }

        .exchange-dropdown:hover .dropdown-content {
          display: block;
        }

        .exchange-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          cursor: pointer;
          white-space: nowrap;
        }

        .exchange-option:hover {
          background-color: var(--hover-bg);
        }

        .exchange-option input {
          cursor: pointer;
        }

        .exchange-option input:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        /* 深色模式适配 */
        :global(.dark-mode) .dropdown-content {
          box-shadow: 0 8px 16px rgba(255,255,255,0.1);
        }

        .symbol-link {
          color: var(--text-color);
          text-decoration: none;
          cursor: pointer;
          transition: opacity 0.3s;
        }

        .symbol-link:hover {
          opacity: 0.7;
          text-decoration: underline;
        }

        /* 移动端适配 */
        @media (max-width: 768px) {
          .header-container {
            padding: 0 10px;
          }

          .controls-container {
            gap: 10px;
          }

          .controls {
            width: 100%;
            justify-content: space-between;
          }

          .search-input {
            font-size: 14px;
            padding: 8px 12px;
          }

          .display-toggle,
          .dropdown-button {
            padding: 6px 10px;
            font-size: 13px;
          }
        }

        /* 深色模式适配 */
        .dark-mode .search-input {
          background: var(--bg-color);
          border-color: var(--table-border);
        }

        .dark-mode .search-input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.2);
        }

        .time-status {
          position: fixed;
          top: 10px;
          right: 10px;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          background-color: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          z-index: 1000;
        }

        .last-update-timestamp {
          opacity: 0.9;
        }

        .calculator-container {
          background-color: var(--bg-color);
          border: 1px solid var(--table-border);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .calculator-input {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--table-border);
          border-radius: 4px;
          background: var(--bg-color);
          color: var(--text-color);
        }

        .param-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .results-container {
          border-top: 1px solid var(--table-border);
          padding-top: 16px;
        }

        .result-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .risk-list {
          list-style: none;
          padding: 0;
        }

        .risk-list li {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .risk-低 { color: #4caf50; }
        .risk-中 { color: #ff9800; }
        .risk-高 { color: #f44336; }
        .risk-极高 { color: #d32f2f; }

        .selected-row {
          border: 2px solid #3b82f6;
        }

        th {
          vertical-align: middle;
          line-height: 1.2;
        }
        .whitespace-nowrap {
          white-space: nowrap;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          border: 1px solid ${isDarkMode ? '#333' : '#e0e0e0'};
        }
      `}</style>
    </div>
  );
} 