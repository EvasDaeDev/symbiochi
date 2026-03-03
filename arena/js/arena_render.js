// Minimal standalone renderer: pixel-cells on canvas.

const CELL_PX = 4;

const TYPE_COLORS = {
  body: '#6ee7b7',
  core: '#fde68a',
  shell: '#93c5fd',
  spike: '#fb7185',
  eye: '#a78bfa',
  fin: '#34d399',
  tail: '#fbbf24',
  tentacle: '#22d3ee',
  antenna: '#60a5fa',
  unknown: '#e5e7eb'
};

function colorForCell(c){
  const t = (c?.type || c?.t || c?.kind || 'body');
  return TYPE_COLORS[t] || TYPE_COLORS.unknown;
}

export function renderArena(ctx, canvas, arena){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // Background grid hint (very subtle)
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  for(let x=0;x<w;x+=CELL_PX*4){ ctx.moveTo(x,0); ctx.lineTo(x,h); }
  for(let y=0;y<h;y+=CELL_PX*4){ ctx.moveTo(0,y); ctx.lineTo(w,y); }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Sun
  if(arena?.sun){
    const sx = arena.sun.x * CELL_PX;
    const sy = arena.sun.y * CELL_PX;
    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.arc(sx, sy, 40, 0, Math.PI*2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Fighters
  const fighters = arena?.fighters || [];
  for(const f of fighters){
    if(!f || !f.alive) continue;
    drawFighter(ctx, f);
  }

  // Winner banner
  if(arena?.mode === 'finished'){
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, h-34, w, 34);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e7e8ef';
    ctx.font = '14px system-ui';
    const txt = arena?.resultText || 'Finished';
    ctx.fillText(txt, 12, h-12);
  }
}

function drawFighter(ctx, f){
  const cells = f?.worldCells || [];

  // Soft glow
  ctx.globalAlpha = 0.12;
  for(const c of cells){
    const x = c.px, y = c.py;
    ctx.fillStyle = '#7dd3fc';
    ctx.fillRect(x-1, y-1, CELL_PX+2, CELL_PX+2);
  }
  ctx.globalAlpha = 1;

  for(const c of cells){
    ctx.fillStyle = colorForCell(c);
    ctx.fillRect(c.px, c.py, CELL_PX, CELL_PX);
  }
}

export function cellPx(){ return CELL_PX; }
