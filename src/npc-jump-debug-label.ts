import * as THREE from "three";

export function createJumpDebugTextSprite(initialText: string): {
  sprite: THREE.Sprite;
  setText: (text: string) => void;
} {
  if (typeof document === "undefined") {
    throw new Error("document is not available");
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context");
  }

  canvas.width = 512;
  canvas.height = 192;
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    depthTest: false,
    depthWrite: false,
  } as any);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(165, 62, 1);

  let lastText = "";
  const draw = (text: string) => {
    const t = String(text ?? "");
    if (t === lastText) return;
    lastText = t;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(18, 22, 24, 0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(70, 220, 120, 0.9)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    const lines = t.split("\n");
    ctx.font = "bold 34px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? "#8dff9d" : "#f2fff4";
      ctx.fillText(lines[i], 16, y);
      y += 42;
      if (y > canvas.height - 30) break;
    }
    texture.needsUpdate = true;
  };

  draw(initialText);
  return { sprite, setText: draw };
}
