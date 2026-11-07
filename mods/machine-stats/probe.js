// The shell that reads one machine: POSIX sh, macOS and Linux. Prints key=value lines;
// big numbers through printf %.0f (mawk prints them in exponent form otherwise).
export const PROBE = String.raw`
PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
os=$(uname -s); echo "os=$os"
echo "host=$(hostname 2>/dev/null)"
if [ "$os" = Darwin ]; then
  echo "cores=$(sysctl -n hw.ncpu)"
  echo "load=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1, $2, $3}')"
  echo "memtotal=$(sysctl -n hw.memsize)"
  vm_stat | awk '/page size of/{ps=$8} /Pages active/{a=$3} /Pages wired/{w=$4} /occupied by compressor/{c=$5} END{printf "memused=%.0f\n", (a+w+c)*ps}'
  sysctl -n vm.swapusage | awk '{t=$3; u=$6; sub(/M/,"",t); sub(/M/,"",u); printf "swaptotal=%.0f\nswapused=%.0f\n", t*1048576, u*1048576}'
  b=$(sysctl -n kern.boottime | sed 's/^{ sec = \([0-9]*\).*/\1/'); echo "uptime=$(( $(date +%s) - b ))"
  top -l 2 -n 0 -s 1 2>/dev/null | awk '/CPU usage/{i=$7} END{sub(/%/,"",i); print "cpu=" 100-i}'
  d=/System/Volumes/Data; [ -d $d ] || d=/
else
  echo "cores=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
  echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
  awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} /^SwapTotal/{st=$2} /^SwapFree/{sf=$2} END{printf "memtotal=%.0f\nmemused=%.0f\nswaptotal=%.0f\nswapused=%.0f\n", t*1024, (t-a)*1024, st*1024, (st-sf)*1024}' /proc/meminfo
  echo "uptime=$(cut -d. -f1 /proc/uptime)"
  a=$(head -1 /proc/stat); sleep 1; b=$(head -1 /proc/stat)
  echo "$a
$b" | awk '{idle=$5+$6; tot=0; for(i=2;i<=NF;i++) tot+=$i; if (NR==1){i0=idle;t0=tot} else {dt=tot-t0; printf "cpu=%.1f\n", dt>0 ? 100*(1-(idle-i0)/dt) : 0}}'
  d=/
fi
df -kP $d | awk 'NR==2{printf "disktotal=%.0f\ndiskused=%.0f\n", $2*1024, ($2-$4)*1024}'
ps -Ao pcpu=,rss=,comm= 2>/dev/null | sort -rn | head -5 | sed 's/^ */proc=/'
`;
