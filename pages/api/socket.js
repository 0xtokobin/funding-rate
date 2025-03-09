import { Server } from 'socket.io';

// 缓存配置
const CACHE_DURATION = 60000; // 1分钟
let cachedData = null;
let lastCacheTime = 0;

// Socket.IO服务器实例
let io;

export default function SocketHandler(req, res) {
  // 获取完整的主机URL
  const protocol = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  
  if (!res.socket.server.io) {
    console.log('初始化Socket.IO服务器...');
    
    // 创建新的Socket.IO实例
    io = new Server(res.socket.server, {
      path: '/api/socket',
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    // 保存io实例到服务器对象
    res.socket.server.io = io;
    
    // 监听连接事件
    io.on('connection', socket => {
      console.log('新客户端连接:', socket.id);
      
      // 发送连接成功消息
      socket.emit('connected', { status: 'success', message: '连接成功', timestamp: new Date().toISOString() });
      
      // 如果有缓存数据，立即发送
      if (cachedData) {
        socket.emit('funding-rates', cachedData);
      }
      
      // 客户端请求数据
      socket.on('get-funding-rates', async () => {
        try {
          // 检查缓存是否有效
          const currentTime = Date.now();
          if (!cachedData || currentTime - lastCacheTime > CACHE_DURATION) {
            console.log('Socket请求: 获取新的资金费率数据');
            // 使用完整URL
            const response = await fetch(`${baseUrl}/api/funding-rates`);
            if (!response.ok) {
              throw new Error(`HTTP error: ${response.status}`);
            }
            cachedData = await response.json();
            lastCacheTime = currentTime;
            console.log('Socket请求: 数据获取成功，记录数:', cachedData.data?.length || 0);
          } else {
            console.log('Socket请求: 使用缓存数据');
          }
          
          // 发送数据给客户端
          socket.emit('funding-rates', {
            ...cachedData,
            lastUpdate: new Date().toISOString() 
          });
        } catch (error) {
          console.error('获取资金费率错误:', error);
          socket.emit('error', { message: '获取数据失败', error: error.message });
        }
      });
      
      // 断开连接
      socket.on('disconnect', () => {
        console.log('客户端断开连接:', socket.id);
      });
    });
  }
  
  // 连接已建立，返回成功响应
  res.status(200).json({ success: true });
} 