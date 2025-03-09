// 這是一個 Next.js 的根組件
// 用來包裝所有頁面組件，提供全局樣式和共享功能
// 引入全局 CSS 樣式
import '../styles/globals.css'

// MyApp 組件接收兩個 props:
// - Component: 當前頁面組件
// - pageProps: 頁面組件的 props
function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />
}

// 導出 MyApp 作為應用程序的根組件
export default MyApp 