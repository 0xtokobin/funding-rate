import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

export default function TestSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 添加日志
    const addLog = (msg) => {
      setLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
    };

    async function initSocket() {
      try {
        // 确保Socket端点可用
        addLog('尝试连接Socket.IO...');
        await fetch('/api/socket');
        
        // 创建Socket实例
        const socketIo = io(undefined, {
          path: '/api/socket',
          transports: ['polling', 'websocket']
        });
        
        socketIo.on('connect', () => {
          addLog(`连接成功! ID: ${socketIo.id}`);
          setIsConnected(true);
          setError(null);
          
          // 请求数据
          socketIo.emit('get-funding-rates');
        });
        
        socketIo.on('connected', (data) => {
          addLog(`收到连接确认: ${JSON.stringify(data)}`);
        });
        
        socketIo.on('funding-rates', (data) => {
          addLog(`收到资金费率数据: ${data.data?.length || 0}条记录`);
        });
        
        socketIo.on('disconnect', () => {
          addLog('连接断开');
          setIsConnected(false);
        });
        
        socketIo.on('connect_error', (err) => {
          const errMsg = `连接错误: ${err.message}`;
          addLog(errMsg);
          setError(errMsg);
        });
        
        return () => {
          addLog('关闭连接');
          socketIo.disconnect();
        };
      } catch (err) {
        const errMsg = `初始化错误: ${err.message}`;
        addLog(errMsg);
        setError(errMsg);
      }
    }
    
    const cleanup = initSocket();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Socket.IO 连接测试</h1>
      
      <div style={{ 
        padding: '10px', 
        borderRadius: '5px', 
        backgroundColor: isConnected ? '#4caf50' : '#f44336',
        color: 'white',
        marginBottom: '20px'
      }}>
        状态: {isConnected ? '已连接' : '未连接'}
        {error && <div style={{ marginTop: '10px', fontSize: '14px' }}>{error}</div>}
      </div>
      
      <div>
        <h3>连接日志:</h3>
        <div style={{ 
          height: '400px', 
          overflow: 'auto', 
          backgroundColor: '#f5f5f5', 
          padding: '10px',
          borderRadius: '5px'
        }}>
          {log.map((entry, i) => (
            <div key={i} style={{ marginBottom: '5px' }}>{entry}</div>
          ))}
        </div>
      </div>
      
      <div style={{ marginTop: '20px' }}>
        <a href="/" style={{ color: 'blue', textDecoration: 'underline' }}>
          返回主页
        </a>
      </div>
    </div>
  );
} 