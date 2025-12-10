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
        {/* Suppress ONNX runtime warnings before any modules load */}
        <Script id="suppress-onnx" strategy="beforeInteractive">{`
          (function() {
            const originalWarn = console.warn;
            const originalError = console.error;
            const suppress = (msg) => typeof msg === 'string' && (
              msg.includes('onnxruntime') || 
              msg.includes('VerifyEachNodeIsAssignedToAnEp') ||
              msg.includes('session_state.cc')
            );
            console.warn = function(...args) { if (!suppress(args[0])) originalWarn.apply(console, args); };
            console.error = function(...args) { if (!suppress(args[0])) originalError.apply(console, args); };
          })();
        `}</Script>
      </head>
      <body>{children}</body>
    </html>
  )
}
