import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./popup.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ember: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c"
        },
        coral: {
          300: "#ffb18b",
          400: "#ff8b5f",
          500: "#f45d48"
        },
        soot: "#2b2828",
        porcelain: "#f7f4ef"
      },
      borderRadius: {
        card: "28px",
        soft: "20px"
      },
      boxShadow: {
        glass: "0 18px 50px rgba(52, 45, 39, 0.14)",
        pill: "0 10px 22px rgba(60, 55, 50, 0.12)",
        ember: "0 18px 36px rgba(244, 93, 72, 0.28)"
      },
      fontFamily: {
        sans: ["Avenir Next", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
