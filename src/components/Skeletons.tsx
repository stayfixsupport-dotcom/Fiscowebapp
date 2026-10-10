/** Shared shimmer placeholders so routes feel instant while they resolve. */

function Bar({ className = "" }: { className?: string }) {
  return <span className={`shimmer block rounded-full ${className}`} />;
}

export function DocumentsListSkeleton() {
  return (
    <div className="relative mx-auto w-full max-w-[1180px] px-4 pt-16 pb-32">
      <div className="glass rounded-4xl p-5 sm:p-6">
        <Bar className="h-2.5 w-24" />
        <Bar className="mt-4 h-9 w-52" />
        <Bar className="mt-5 h-1.5 w-full" />
      </div>
      <Bar className="mt-4 h-11 w-full rounded-2xl" />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass rounded-3xl p-4">
            <div className="flex items-center gap-3">
              <Bar className="size-11 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <Bar className="h-3 w-2/3" />
                <Bar className="mt-2 h-2.5 w-1/3" />
              </div>
              <Bar className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentDetailSkeleton() {
  return (
    <div className="relative mx-auto w-full max-w-[560px] px-4 pt-16 pb-44">
      <div className="glass rounded-[30px] p-5">
        <div className="flex items-start gap-4">
          <Bar className="h-[124px] w-[96px] rounded-2xl" />
          <div className="min-w-0 flex-1">
            <Bar className="h-2.5 w-28" />
            <Bar className="mt-3 h-7 w-3/4" />
            <Bar className="mt-2 h-3 w-1/2" />
            <Bar className="mt-5 h-8 w-40" />
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
      <Bar className="mt-3 h-52 rounded-[28px]" />
      <Bar className="mt-3 h-20 rounded-[28px]" />
    </div>
  );
}
