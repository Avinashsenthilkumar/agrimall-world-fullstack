import './globals.css';
import { AppProvider } from '../lib/AppContext';
export const metadata = { title:'Agri Mall — The Global Plant Marketplace', description:'Order any plant, delivered fresh from nurseries worldwide.' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
      </head>
      <body>
        <AppProvider>
          <canvas id="cfv"/>
          <div id="ptcl"/>
          <div id="toast-wrap" className="toast-wrap"/>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
