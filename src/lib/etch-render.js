export class EtchRenderer {
  constructor(canvas, lineWidth = 3, lineSpacing = 2, background = "white") {
    this.canvas = canvas;
    this.lineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.background = background;

    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("Failed to get 2D context from canvas");
  }

  setBackground(background) {
    this.background = background;
    // TODO: Should this be handled in a set/get pattern
    // How to trigger re-render?
  }

  addCircleLayer(config) {
    console.log(config);
  }

  draw() {
    console.log("Drawing to canvas");
    // For testing, we are only going to draw one line at y=200
    // First, we will just draw the background colour with the line
  }

  renderCell(cell, showNumbers = false) {
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
    this.context.fillStyle = "lightblue";
    this.context.fill();
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 1.5 * Math.PI, 0.5 * Math.PI);
    this.context.strokeStyle = "blue";
    this.context.lineWidth = 1;
    this.context.stroke();

    if (showNumbers) {
      this.context.save();
      this.context.fillStyle = "blue";
      this.context.font = `${Math.max(10, cell.radius * 0.5)}px sans-serif`;
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(String(cell.id), cell.x, cell.y);
      this.context.restore();
    }
  }

  renderCells(cells) {
    for (const cell of cells) {
      this.renderCell(cell);
    }
  }

  renderPolygon(polygon) {
    if (!polygon || polygon.length === 0) return;

    this.context.beginPath();
    this.context.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      this.context.lineTo(polygon[i].x, polygon[i].y);
    }
    this.context.closePath();
    this.context.fillStyle = "rgba(190, 216, 230, 0.4)"; // Light blue with transparency
    this.context.fill();
    //this.context.strokeStyle = "blue";
    //this.context.lineWidth = 1;
    //this.context.stroke();
  }
}
