import type { Metadata } from "next"
import "./globals.css"
import Script from "next/script"

export const metadata: Metadata = {
  title: "Voice Chat",
  description: "Real-time AI voice chat running on your device",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Suppress noisy library warnings before any modules load */}
        <Script id="suppress-onnx" strategy="beforeInteractive">{`
          (function() {
            const originalWarn = console.warn;
            const originalError = console.error;
            const suppress = (...args) => args.some(arg => 
              typeof arg === 'string' && (
                arg.includes('onnxruntime') || 
                arg.includes('VerifyEachNodeIsAssignedToAnEp') ||
                arg.includes('session_state.cc') ||
                arg.includes('[W:onnxruntime') ||
                arg.includes('content-length') ||
                arg.includes('Unknown model class')
              )
            );
            console.warn = function(...args) { if (!suppress(...args)) originalWarn.apply(console, args); };
            console.error = function(...args) { if (!suppress(...args)) originalError.apply(console, args); };
          })();
        `}</Script>
      </head>
      <body>{children}</body>
    </html>
  )
}
