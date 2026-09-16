import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
        background: "#0B0B0C",
        color: "#F4F3F1",
      }}
    >
      <div>
        <p style={{ margin: "0 0 12px", opacity: 0.72 }}>This episode is unavailable.</p>
        <Link href="/" style={{ textDecoration: "underline" }}>
          Back to feed
        </Link>
      </div>
    </main>
  );
}
