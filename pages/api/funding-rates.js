// 使用 Next.js 的內置 API 路由處理 WebSocket
import { Server } from 'socket.io';

// 緩存配置
const CACHE_DURATION = 60000; // 1分鐘
let cachedData = null;
let lastCacheTime = 0;

// 创建 socket.io 实例
let io;

// 确保只初始化一次
if (!global.io) {
  console.log('初始化Socket.IO服务器');
  global.io = new Server();
  io = global.io;
} else {
  console.log('使用已存在的Socket.IO服务器');
  io = global.io;
}

// 主要的 API 处理函数
export default async function handler(req, res) {
  try {
    console.log('开始处理资金费率请求...');
    const currentTime = Date.now();
    
    // 检查缓存是否有效
    if (cachedData && currentTime - lastCacheTime < CACHE_DURATION) {
      console.log('返回缓存的资金费率数据');
      return res.status(200).json(cachedData);
    }

    // 获取新数据
    console.log('开始获取新的资金费率数据...');
    const rates = await fetchAllExchangeData();
    
    if (!rates || !rates.success || !Array.isArray(rates.data)) {
      return res.status(500).json({ success: false, error: "获取资金费率数据失败" });
    }
    
    // 计算套利机会
    const arbitrageOpportunities = calculateArbitrageOpportunities(rates.data);
    
    // 构造响应数据
    const result = {
      success: true,
      data: rates.data,
      arbitrageOpportunities,
      lastUpdate: new Date().toISOString()
    };
    
    // 更新缓存
    cachedData = result;
    lastCacheTime = currentTime;
    
    res.status(200).json(result);
  } catch (error) {
    console.error('API处理错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// 添加定时广播功能
const broadcastData = async () => {
  try {
    console.log('执行定时数据广播');
    const data = await fetchAllExchangeData();
    
    // 更新缓存
    cachedData = data;
    lastCacheTime = Date.now();
    
    if (global.io) {
      console.log('广播数据到所有连接的客户端');
      global.io.emit('funding-rates', {
        ...data,
        lastUpdate: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('广播数据错误:', error);
  }
};

// 每30秒更新一次数据
setInterval(broadcastData, 30000);

async function fetchAllExchangeData() {
  try {
    console.log('開始獲取交易所數據...');
    
    const apiCalls = [
      { name: 'Binance Rates', url: 'https://fapi.binance.com/fapi/v1/premiumIndex' },
      { name: 'Binance Funding Info', url: 'https://fapi.binance.com/fapi/v1/fundingInfo' },
      { name: 'Bybit Rates', url: 'https://api.bybit.com/v5/market/tickers?category=linear' },
      { name: 'Bybit Instruments', url: 'https://api.bybit.com/v5/market/instruments-info?category=linear' },
      { 
        name: 'Bitget Rates', 
        url: 'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES',
        options: {
          headers: {
            'Content-Type': 'application/json',
            'locale': 'zh-CN'
          }
        }
      },
      { 
        name: 'Bitget Contracts', 
        url: 'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES',
        options: {
          headers: {
            'Content-Type': 'application/json',
            'locale': 'zh-CN'
          }
        }
      },
      { name: 'OKX Tickers', url: 'https://www.okx.com/api/v5/public/mark-price?instType=SWAP' },
      { name: 'OKX Instruments', url: 'https://www.okx.com/api/v5/public/instruments?instType=SWAP' },
      { 
        name: 'Hyperliquid', 
        url: 'https://api.hyperliquid.xyz/info',
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        }
      },
      { name: 'Gate Contracts', url: 'https://api.gateio.ws/api/v4/futures/usdt/contracts' }
    ];

    const responses = await Promise.all(
      apiCalls.map(async ({ name, url, options = {} }) => {
        try {
          const response = await fetch(url, options);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const text = await response.text();
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error(`JSON 解析錯誤 (${name}):`, e);
            console.error('收到的響應:', text.substring(0, 200) + '...');
            return null;
          }
        } catch (error) {
          console.error(`${name} API 調用失敗:`, error);
          return null;
        }
      })
    );

    const [
      binanceRatesData, 
      binanceFundingInfoData, 
      bybitRatesData, 
      bybitInstrumentsData,
      bitgetRatesData, 
      bitgetContractsData,
      okxTickersData,
      okxInstrumentsData,
      hyperliquidData,
      gateContractsData
    ] = responses;

    // 檢查是否所有必需的數據都成功獲取
    if (!binanceRatesData || !bybitRatesData || !bitgetRatesData || !okxTickersData) {
      console.error('部分關鍵數據獲取失敗:', {
        binanceRatesData: !!binanceRatesData,
        bybitRatesData: !!bybitRatesData,
        bitgetRatesData: !!bitgetRatesData,
        okxTickersData: !!okxTickersData
      });
    }

    // 創建幣安結算週期映射
    const binanceIntervals = {};
    if (binanceFundingInfoData) {
      binanceFundingInfoData.forEach(info => {
        binanceIntervals[info.symbol] = parseInt(info.fundingIntervalHours) || 8;
      });
    }

    // 創建 Bybit 結算週期映射
    const bybitIntervals = {};
    if (bybitInstrumentsData?.result?.list) {
      bybitInstrumentsData.result.list.forEach(instrument => {
        bybitIntervals[instrument.symbol] = (parseInt(instrument.fundingInterval) || 480) / 60;
      });
    }

    // 處理幣安數據
    const binanceRates = binanceRatesData
      ? binanceRatesData
          .filter(item => item.symbol.endsWith('USDT'))
          .map(item => {
            const interval = binanceIntervals[item.symbol] || 8;
            return {
              symbol: item.symbol.replace('USDT', ''),
              exchange: 'Binance',
              currentRate: (parseFloat(item.lastFundingRate) * 100).toFixed(4),
              isSpecialInterval: interval !== 8,
              settlementInterval: interval
            };
          })
      : [];

    // 創建 Bitget 合約結算週期映射
    const bitgetIntervals = {};
    if (bitgetContractsData?.data) {
      bitgetContractsData.data.forEach(contract => {
        bitgetIntervals[contract.symbol] = parseInt(contract.fundInterval) || 8;
      });
    }

    // 處理 HyperLiquid 數據
    let hyperliquidRates = [];
    if (hyperliquidData) {
      try {
        const [metadata, assetContexts] = hyperliquidData;
        hyperliquidRates = metadata.universe.map((asset, index) => {
          const assetData = assetContexts[index];
          const rate = (parseFloat(assetData.funding) * 100).toFixed(4);
          return {
            symbol: asset.name,
            exchange: 'HyperLiquid',
            currentRate: rate,
            isSpecialInterval: true,
            settlementInterval: 1
          };
        });
      } catch (error) {
        console.error('HyperLiquid 數據處理錯誤:', error);
      }
    }

    // 處理 Bybit 數據
    const bybitRates = bybitRatesData?.result?.list
      ? bybitRatesData.result.list
          .filter(item => item.symbol.endsWith('USDT') && item.fundingRate)
          .map(item => {
            try {
              const interval = bybitIntervals[item.symbol] || 8;
              return {
                symbol: item.symbol.replace('USDT', ''),
                exchange: 'Bybit',
                currentRate: (parseFloat(item.fundingRate) * 100).toFixed(4),
                isSpecialInterval: interval !== 8,
                settlementInterval: interval
              };
            } catch (error) {
              console.error('Bybit 數據處理錯誤:', error, item);
              return null;
            }
          })
          .filter(item => item !== null)
      : [];

    // 處理 Bitget 數據
    const bitgetRates = bitgetRatesData?.data
      ? bitgetRatesData.data
          .filter(item => item.symbol && item.fundingRate)
          .map(item => {
            try {
              const symbol = item.symbol.replace('USDT', '');
              const interval = bitgetIntervals[item.symbol] || 8;
              return {
                symbol,
                exchange: 'Bitget',
                currentRate: (parseFloat(item.fundingRate) * 100).toFixed(4),
                isSpecialInterval: interval !== 8,
                settlementInterval: interval
              };
            } catch (error) {
              console.error('Bitget 數據處理錯誤:', error, item);
              return null;
            }
          })
          .filter(item => item !== null)
      : [];

    // 處理 OKX 數據
    let okxRates = [];
    try {
      // 1. 先從 tickers 獲取所有 USDT 永續合約
      const okxUsdtContracts = (okxTickersData.data || [])
        .filter(item => item.instId && item.instId.endsWith('-USDT-SWAP'))
        .map(item => item.instId);
        
      console.log(`OKX USDT合约数: ${okxUsdtContracts.length}`);
        
      // 添加安全的获取单个合约数据的函数
      const fetchWithTimeout = async (url, timeout = 5000) => {
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          return await response.json();
        } catch (error) {
          return null; // 出错时返回null
        }
      };
      
      // 2. 批量获取这些合约的资金费率，加入错误处理和重试
      console.log(`开始获取OKX资金费率数据...`);
      
      // 增加批次大小到 50
      const batchSize = 50;
      let okxFundingRatesData = [];
      
      // 分批处理，避免同时发送太多请求
      for (let i = 0; i < okxUsdtContracts.length; i += batchSize) {
        const batch = okxUsdtContracts.slice(i, Math.min(i + batchSize, okxUsdtContracts.length));
        console.log(`处理OKX批次 ${Math.floor(i/batchSize) + 1}/${Math.ceil(okxUsdtContracts.length/batchSize)}`);
        
        // 并行获取每批
        const batchResults = await Promise.all(
          batch.map(instId => 
            fetchWithTimeout(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, 10000)
              .catch(() => null) // 确保即使请求失败也不会抛出错误
          )
        );
        
        // 添加到结果集
        okxFundingRatesData.push(...batchResults.filter(result => result !== null));
        
        // 减少延迟时间到 200ms
        if (i + batchSize < okxUsdtContracts.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
        
      // 3. 處理資金費率數據
      okxRates = okxFundingRatesData
        .filter(data => data.data && data.data[0])
        .map(data => {
          try {
            const item = data.data[0];
            const symbol = item.instId.split('-')[0];
            const fundingRate = parseFloat(item.fundingRate);

            if (!item.instId || !fundingRate || isNaN(fundingRate)) {
              return null;
            }

            // 計算結算週期（毫秒轉換為小時）
            const nextFundingTime = parseInt(item.nextFundingTime);
            const currentFundingTime = parseInt(item.fundingTime);
            const interval = (nextFundingTime - currentFundingTime) / (1000 * 60 * 60);

            return {
              symbol,
              exchange: 'OKX',
              currentRate: (fundingRate * 100).toFixed(4),
              isSpecialInterval: interval !== 8,  // 如果不是8小時就標記
              settlementInterval: interval,  // 實際結算間隔
              nextFundingTime: new Date(nextFundingTime).toISOString(),
              fundingTime: new Date(currentFundingTime).toISOString()
            };
          } catch (error) {
            return null;
          }
        })
        .filter(item => item !== null);
        
      console.log(`OKX处理完成: 总合约数=${okxUsdtContracts.length}, 成功获取=${okxRates.length}`);
    } catch (error) {
      console.error('处理 OKX 数据时发生错误:', error.message);
      // 即使OKX处理失败，也不影响其他交易所的数据
    }

    // 處理 Gate 數據
    let gateRates = [];
    if (gateContractsData && Array.isArray(gateContractsData)) {
      try {
        console.log(`Gate合约总数: ${gateContractsData.length}`);
        
        // 过滤出所有 USDT 合约
        const usdtContracts = gateContractsData.filter(contract => 
          contract.name && contract.name.endsWith('_USDT')
        );
        console.log(`Gate USDT合约数: ${usdtContracts.length}`);
        
        // 从合约信息中直接提取资金费率
        console.log(`处理Gate合约资金费率`);
        
        // 直接从合约信息中提取资金费率
        gateRates = usdtContracts
          .map(contract => {
            try {
              // 检查合约是否有资金费率
              if (!contract.funding_rate) return null;
              
              const symbol = contract.name.replace('_USDT', '');
              const interval = contract.funding_interval / 3600 || 8;
              
              return {
                symbol,
                exchange: 'Gate',
                currentRate: (parseFloat(contract.funding_rate) * 100).toFixed(4),
                isSpecialInterval: interval !== 8,
                settlementInterval: interval
              };
            } catch (err) {
              return null;
            }
          })
          .filter(item => item !== null);
        
        console.log(`Gate处理完成: 总合约数=${usdtContracts.length}, 成功获取=${gateRates.length}`);
      } catch (error) {
        console.error('处理 Gate 数据时发生错误:', error.message);
      }
    }

    // 合併所有交易所的數據
    const allRates = [
      ...binanceRates,
      ...bybitRates,
      ...bitgetRates,
      ...okxRates,
      ...hyperliquidRates,
      ...gateRates
    ].filter(item => {
      // 確保 item 和 currentRate 存在且為有效數值
      return item && 
        item.currentRate && 
        !isNaN(parseFloat(item.currentRate)) && 
        parseFloat(item.currentRate) !== 0;
    });

    // 计算套利机会
    const arbitrageOpportunities = calculateArbitrageOpportunities(allRates);

    console.log('數據處理完成，各交易所數據數量:', {
      binance: binanceRates?.length || 0,
      bybit: bybitRates?.length || 0,
      bitget: bitgetRates?.length || 0,
      okx: okxRates?.length || 0,
      hyperliquid: hyperliquidRates?.length || 0,
      gate: gateRates?.length || 0
    });

    return {
      success: true,
      data: allRates,
      arbitrageOpportunities, // 添加套利机会数据
      debug: {
        bitgetCount: bitgetRates?.length || 0,
        binanceCount: binanceRates?.length || 0,
        bybitCount: bybitRates?.length || 0,
        okxCount: okxRates?.length || 0,
        hyperliquidCount: hyperliquidRates?.length || 0,
        gateCount: gateRates?.length || 0,
        totalCount: allRates.length
      }
    };
  } catch (error) {
    console.error('fetchAllExchangeData 發生錯誤:', error);
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
}

/**
 * 计算资金费率套利机会
 * @param {Array} ratesData - 所有交易所的资金费率数据
 * @returns {Array} 套利机会列表
 */
function calculateArbitrageOpportunities(rates) {
  console.log('开始计算套利机会，输入数据数量:', rates.length);
  const opportunities = [];
  const groupedRates = {};

  // 按交易对分组
  rates.forEach(rate => {
    if (!rate.symbol || !rate.exchange || rate.currentRate === undefined) return;
    if (!groupedRates[rate.symbol]) {
      groupedRates[rate.symbol] = [];
    }
    
    // 处理结算周期
    const settlementInterval = rate.settlementInterval || (rate.isHourly ? 1 : 8);
    const currentRate = parseFloat(rate.currentRate);
    
    if (isNaN(currentRate)) return;

    groupedRates[rate.symbol].push({
      ...rate,
      currentRate: currentRate,
      settlementInterval: settlementInterval
    });
  });

  // 计算套利机会
  Object.keys(groupedRates).forEach(symbol => {
    const symbolRates = groupedRates[symbol];
    
    for (let i = 0; i < symbolRates.length; i++) {
      for (let j = i + 1; j < symbolRates.length; j++) {
        const rate1 = symbolRates[i];
        const rate2 = symbolRates[j];
        
        // 跨周期套利策略
        if (rate1.settlementInterval !== rate2.settlementInterval) {
          // 找出短周期（即将结算）和长周期的交易所
          const shortPeriodRate = rate1.settlementInterval < rate2.settlementInterval ? rate1 : rate2;
          const longPeriodRate = rate1.settlementInterval < rate2.settlementInterval ? rate2 : rate1;
          
          // 如果短周期是负费率，这是个好机会
          // 因为我们可以在短周期做多（收取负费率），在长周期做空（暂时不用付费）
          if (shortPeriodRate.currentRate < 0) {
            // 计算预期收益：短周期的负费率收益（确定的）
            const expectedProfit = Math.abs(shortPeriodRate.currentRate);
            
            // 年化计算：考虑短周期的结算频率
            const annualYield = expectedProfit * (24 / shortPeriodRate.settlementInterval) * 365;
            
            if (expectedProfit > 0.005) { // 至少0.005%的预期收益
              opportunities.push({
                symbol,
                type: 'different_period',
                longExchange: shortPeriodRate.exchange,  // 做多短周期（负费率）
                shortExchange: longPeriodRate.exchange,  // 做空长周期（暂不付费）
                longRate: shortPeriodRate.currentRate,   // 负费率
                shortRate: longPeriodRate.currentRate,   // 长周期费率（参考）
                rateDiff: Math.abs(shortPeriodRate.currentRate - longPeriodRate.currentRate),
                settlementPeriod1: shortPeriodRate.settlementInterval,
                settlementPeriod2: longPeriodRate.settlementInterval,
                expectedProfit,
                annualYield
              });
            }
          }
        }
        // 同周期套利策略
        else {
          const rateDiff = rate1.currentRate - rate2.currentRate;
          if (Math.abs(rateDiff) < 0.001) continue; // 忽略差异太小的机会
          
          const annualYield = Math.abs(rateDiff) * (24 / rate1.settlementInterval) * 365;
          
          if (annualYield > 1) { // 年化收益至少1%
            opportunities.push({
              symbol,
              type: 'same_period',
              longExchange: rateDiff > 0 ? rate2.exchange : rate1.exchange,
              shortExchange: rateDiff > 0 ? rate1.exchange : rate2.exchange,
              longRate: rateDiff > 0 ? rate2.currentRate : rate1.currentRate,
              shortRate: rateDiff > 0 ? rate1.currentRate : rate2.currentRate,
              rateDiff: Math.abs(rateDiff),
              settlementPeriod: rate1.settlementInterval,
              annualYield
            });
          }
        }
      }
    }
  });

  // 分别按年化收益排序
  opportunities.sort((a, b) => {
    // 首先按类型分组
    if (a.type !== b.type) {
      return a.type === 'different_period' ? -1 : 1; // 不同周期的排在前面
    }
    // 同类型内按收益排序
    return b.annualYield - a.annualYield;
  });

  console.log('套利机会统计:', {
    total: opportunities.length,
    differentPeriod: opportunities.filter(o => o.type === 'different_period').length,
    samePeriod: opportunities.filter(o => o.type === 'same_period').length
  });

  return opportunities;
}

// 配置 API 路由以支持 WebSocket
export const config = {
  api: {
    bodyParser: false,
  },
};