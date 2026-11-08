// The bar chart of an award's costs by budget category, drawn with the
// vendored Plotly bar-chart bundle. The library loads the first time a chart
// is drawn, so pages that never show one don't pay for it.

let loading = null;

export const loadPlotly = () =>
  (loading ??= new Promise((resolve, reject) => {
    if (window.Plotly) return resolve(window.Plotly);
    const script = document.createElement('script');
    script.src = 'vendor/plotly-basic.min.js';
    script.onload = () => resolve(window.Plotly);
    script.onerror = () => {
      loading = null;
      reject(new Error('The chart library did not load.'));
    };
    document.head.append(script);
  }));

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Breaks a long category name over lines of about `width` characters, for the axis under its bar. */
const wrap = (text, width = 14) => {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('<br>');
};

/**
 * Draws one award's costs as vertical bars, largest first. Hovering a bar
 * shows its amount and share of the total; the camera button saves a PNG.
 */
export const drawCostChart = async (node, award) => {
  const Plotly = await loadPlotly();
  const categories = [...award.categories].sort((a, b) => b.cents - a.cents);
  const share = (cents) => (award.totalCents ? ((cents / award.totalCents) * 100).toFixed(1) : '0.0');
  const text = token('--text');
  const muted = token('--muted');
  const border = token('--border');
  const surface = token('--surface');
  const data = [
    {
      type: 'bar',
      x: categories.map((c) => wrap(c.name)),
      y: categories.map((c) => c.cents / 100),
      customdata: categories.map((c) => [share(c.cents), c.name]),
      hovertemplate: '<b>%{customdata[1]}</b><br>$%{y:,.2f} · %{customdata[0]}% of the total<extra></extra>',
      marker: { color: token('--series-1'), cornerradius: 4 },
    },
  ];
  const layout = {
    height: 300,
    margin: { l: 8, r: 8, t: 12, b: 8 },
    bargap: 0.4,
    showlegend: false,
    dragmode: false,
    paper_bgcolor: surface,
    plot_bgcolor: surface,
    font: { family: getComputedStyle(document.body).fontFamily, size: 12, color: muted },
    xaxis: { automargin: true, fixedrange: true, ticks: '', tickangle: 0, tickfont: { color: text, size: 11 } },
    yaxis: {
      automargin: true,
      tickprefix: '$',
      tickformat: ',.0f',
      gridcolor: border,
      zeroline: true,
      zerolinecolor: muted,
      fixedrange: true,
    },
    hoverlabel: { bgcolor: surface, bordercolor: border, font: { color: text, family: getComputedStyle(document.body).fontFamily } },
  };
  const config = {
    displaylogo: false,
    responsive: true,
    modeBarButtons: [['toImage']],
    toImageButtonOptions: { format: 'png', filename: `${award.award}_costs`, scale: 2 },
  };
  await Plotly.react(node, data, layout, config);
};
