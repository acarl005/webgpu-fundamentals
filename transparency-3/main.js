import { mat4 } from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";
import GUI from "https://webgpufundamentals.org/3rdparty/muigui-0.x.module.js";

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {string}
 */
function hsl(h, s, l) {
  return `hsl(${(h * 360) | 0}, ${(s * 100) | 0}%, ${(l * 100) | 0}%)`;
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @param {number} a
 * @returns {string}
 */
function hsla(h, s, l, a) {
  return `hsla(${(h * 360) | 0}, ${(s * 100) | 0}%, ${(l * 100) | 0}%, ${a})`;
}

/**
 * @param {number} size
 * @returns {HTMLCanvasElement}
 */
function createDestinationImage(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  for (let i = 0; i <= 6; i++) {
    gradient.addColorStop(i / 6, hsl(i / -6, 1, 0.5));
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "rgba(0, 0, 0, 255)";
  ctx.globalCompositeOperation = "destination-out";
  ctx.rotate(Math.PI / -4);
  for (let i = 0; i < size * 2; i += 32) {
    ctx.fillRect(-size, i, size * 2, 16);
  }

  return canvas;
}

/**
 * @param {number} size
 * @returns {HTMLCanvasElement}
 */
function createSourceImage(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);

  ctx.globalCompositeOperation = "screen";
  const numCircles = 3;
  for (let i = 0; i < numCircles; i++) {
    ctx.rotate((Math.PI * 2) / numCircles);
    ctx.save();
    ctx.translate(size / 6, 0);
    ctx.beginPath();

    const radius = size / 3;
    ctx.arc(0, 0, radius, 0, Math.PI * 2);

    const gradient = ctx.createRadialGradient(0, 0, radius / 2, 0, 0, radius);
    const h = i / numCircles;
    gradient.addColorStop(0.5, hsla(h, 1, 0.5, 1));
    gradient.addColorStop(1, hsla(h, 1, 0.5, 0));

    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  return canvas;
}

function numMipLevels(...sizes) {
  const maxSize = Math.max(...sizes);
  return (1 + Math.log2(maxSize)) | 0;
}

const generateMips = (() => {
  /** @type{GPUSampler} */
  let sampler;
  /** @type{GPUShaderModule} */
  let module;
  /** @type{Record<GPUTextureFormat, GPURenderPipeline>} */
  const pipelineByFormat = {};

  /**
   * @param {GPUDevice} device
   * @param {GPUTexture} texture
   */
  return function generateMips(device, texture) {
    if (!module) {
      module = device.createShaderModule({
        label: "textured quad shaders for mip level generation",
        code: /* wgsl */ `
					struct VSOutput {
						@builtin(position) position: vec4f,
						@location(0) texcoord: vec2f,
					};

					@vertex fn vs(
						@builtin(vertex_index) vertexIndex: u32,
					) -> VSOutput {
						let pos = array(
							// 1st triangle
						  vec2f(0.0, 0.0), // center
							vec2f(1.0, 0.0), // right, center
							vec2f(0.0, 1.0), // center, top

							// 2nd triangle
							vec2f(0.0, 1.0), // center, top
							vec2f(1.0, 0.0), // right, center
							vec2f(1.0, 1.0), // right, top
						);

						var vsOutput: VSOutput;
						let xy = pos[vertexIndex];
						vsOutput.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
						vsOutput.texcoord = vec2f(xy.x, 1.0 - xy.y);
						return vsOutput;
					}

					@group(0) @binding(0) var ourSampler: sampler;
					@group(0) @binding(1) var ourTexture: texture_2d<f32>;

					@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
						return textureSample(ourTexture, ourSampler, fsInput.texcoord);
					}
				`,
      });

      sampler = device.createSampler({
        minFilter: "linear",
      });
    }

    if (!pipelineByFormat[texture.format]) {
      pipelineByFormat[texture.format] = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
        },
        fragment: {
          module,
          targets: [{ format: texture.format }],
        },
      });
    }
    const pipeline = pipelineByFormat[texture.format];

    const encoder = device.createCommandEncoder({
      label: "mip gen encoder",
    });

    for (
      let baseMipLevel = 1;
      baseMipLevel < texture.mipLevelCount;
      baseMipLevel++
    ) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          {
            binding: 1,
            resource: texture.createView({
              baseMipLevel: baseMipLevel - 1,
              mipLevelCount: 1,
            }),
          },
        ],
      });

      const renderPassDesc = {
        label: "our basic canvas renderPass",
        colorAttachments: [
          {
            view: texture.createView({
              baseMipLevel,
              mipLevelCount: 1,
            }),
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDesc);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  };
})();

/**
 * @param {GPUDevice} device
 * @param {GPUTexture} texture
 * @param {GPUCopyExternalImageSourceInfo} source
 */
function copySourceToTexture(
  device,
  texture,
  source,
  { flipY, premultipliedAlpha } = {},
) {
  const { width, height } = source;
  device.queue.copyExternalImageToTexture(
    { source, flipY },
    { texture, premultipliedAlpha },
    { width, height },
  );

  if (texture.mipLevelCount > 1) {
    generateMips(device, texture);
  }
}

/**
 * @param {GPUDevice} device
 * @param {GPUCopyExternalImageSourceInfo} source
 * @returns {GPUTexture}
 */
function createTextureFromSource(device, source, options = {}) {
  const texture = device.createTexture({
    format: "rgba8unorm",
    mipLevelCount: options.mips ? numMipLevels(source.width, source.height) : 1,
    size: [source.width, source.height],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  copySourceToTexture(device, texture, source, options);
  return texture;
}

function makeUniformBufferAndValues(device) {
  const kMatrixOffset = 0;

  const values = new Float32Array(16);
  const buffer = device.createBuffer({
    label: "uniforms for quad",
    size: values.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const matrix = values.subarray(kMatrixOffset, 16);
  return { buffer, values, matrix };
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    console.error("WebGPU not supported");
    return;
  }

  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
  });

  const module = device.createShaderModule({
    label: "our hardcoded RGB triangle shaders",
    code: /* wgsl */ `
			struct OurVertexShaderOutput {
				@builtin(position) position: vec4f,
				@location(0) texcoord: vec2f,
			};

			struct Uniforms {
				matrix: mat4x4f
			};

			@group(0) @binding(2) var<uniform> uni: Uniforms;

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> OurVertexShaderOutput {
				let pos = array(
					// 1st triange
				  vec2f(0.0, 0.0), // center
				  vec2f(1.0, 0.0), // right, center
					vec2f(0.0, 1.0), // center, top

					// 2nd triangle
					vec2f(0.0, 1.0), // center, top
					vec2f(1.0, 0.0), // right, center
					vec2f(1.0, 1.0), // right, top
				);

				var vsOutput: OurVertexShaderOutput;
				let xy = pos[vertexIndex];
				vsOutput.position = uni.matrix * vec4f(xy, 0.0, 1.0);
				vsOutput.texcoord = xy;
				return vsOutput;
			}

			@group(0) @binding(0) var ourSampler: sampler;
			@group(0) @binding(1) var ourTexture: texture_2d<f32>;

			@fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
				return textureSample(ourTexture, ourSampler, fsInput.texcoord);
			}
		`,
  });

  const size = 400;
  const srcCanvas = createSourceImage(size);
  const dstCanvas = createDestinationImage(size);

  const srcTextureUnpremultipliedAlpha = createTextureFromSource(
    device,
    srcCanvas,
    { mips: true },
  );
  const dstTextureUnpremultipliedAlpha = createTextureFromSource(
    device,
    dstCanvas,
    { mips: true },
  );
  const srcTexturePremultipliedAlpha = createTextureFromSource(
    device,
    srcCanvas,
    { mips: true, premultipliedAlpha: true },
  );
  const dstTexturePremultipliedAlpha = createTextureFromSource(
    device,
    dstCanvas,
    { mips: true, premultipliedAlpha: true },
  );

  const srcUniform = makeUniformBufferAndValues(device);
  const dstUniform = makeUniformBufferAndValues(device);

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {} },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
  });

  const srcBindGroupUnpremultipliedAlpha = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: srcTextureUnpremultipliedAlpha },
      { binding: 2, resource: { buffer: srcUniform.buffer } },
    ],
  });

  const dstBindGroupUnpremultipliedAlpha = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: dstTextureUnpremultipliedAlpha },
      { binding: 2, resource: { buffer: dstUniform.buffer } },
    ],
  });

  const srcBindGroupPremultipliedAlpha = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: srcTexturePremultipliedAlpha },
      { binding: 2, resource: { buffer: srcUniform.buffer } },
    ],
  });

  const dstBindGroupPremultipliedAlpha = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: dstTexturePremultipliedAlpha },
      { binding: 2, resource: { buffer: dstUniform.buffer } },
    ],
  });

  const textureSets = [
    {
      srcTexture: srcTexturePremultipliedAlpha,
      dstTexture: dstTexturePremultipliedAlpha,
      srcBindGroup: srcBindGroupPremultipliedAlpha,
      dstBindGroup: dstBindGroupPremultipliedAlpha,
    },
    {
      srcTexture: srcTextureUnpremultipliedAlpha,
      dstTexture: dstTextureUnpremultipliedAlpha,
      srcBindGroup: srcBindGroupUnpremultipliedAlpha,
      dstBindGroup: dstBindGroupUnpremultipliedAlpha,
    },
  ];

  const clearValue = [0, 0, 0, 0];
  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        clearValue,
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  const dstPipeline = device.createRenderPipeline({
    label: "hardcoded textured quad pipeline",
    layout: pipelineLayout,
    vertex: {
      module,
    },
    fragment: {
      module,
      targets: [{ format }],
    },
  });

  const color = {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one-minus-src",
  };

  const alpha = {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one-minus-src",
  };

  const constant = {
    color: [1, 0.5, 0.25],
    alpha: 1,
  };

  const presets = {
    "default (copy)": {
      color: {
        operation: "add",
        srcFactor: "one",
        dstFactor: "zero",
      },
    },
    "premultiplied blend (source-over)": {
      color: {
        operation: "add",
        srcFactor: "one",
        dstFactor: "one-minus-src-alpha",
      },
    },
    "un-premultiplied blend": {
      color: {
        operation: "add",
        srcFactor: "src-alpha",
        dstFactor: "one-minus-src-alpha",
      },
    },
    "destination-over": {
      color: {
        operation: "add",
        srcFactor: "one-minus-dst-alpha",
        dstFactor: "one",
      },
    },
    "source-in": {
      color: {
        operation: "add",
        srcFactor: "dst-alpha",
        dstFactor: "zero",
      },
    },
    "destination-in": {
      color: {
        operation: "add",
        srcFactor: "zero",
        dstFactor: "src-alpha",
      },
    },
    "source-out": {
      color: {
        operation: "add",
        srcFactor: "one-minus-dst-alpha",
        dstFactor: "zero",
      },
    },
    "destination-out": {
      color: {
        operation: "add",
        srcFactor: "zero",
        dstFactor: "one-minus-src-alpha",
      },
    },
    "source-atop": {
      color: {
        operation: "add",
        srcFactor: "dst-alpha",
        dstFactor: "one-minus-src-alpha",
      },
    },
    "destination-atop": {
      color: {
        operation: "add",
        srcFactor: "one-minus-dst-alpha",
        dstFactor: "src-alpha",
      },
    },
    "additive (lighten)": {
      color: {
        operation: "add",
        srcFactor: "one",
        dstFactor: "one",
      },
    },
  };

  const clear = {
    color: [0, 0, 0],
    alpha: 0,
    premultiply: true,
  };

  const settings = {
    alphaMode: "premultiplied",
    textureSet: 0,
    preset: "default (copy)",
  };

  /**
   * @param {GPUBlendComponent} blend
   */
  function makeBlendComponentValid(blend) {
    const { operation } = blend;
    if (operation == "min" || operation == "max") {
      blend.srcFactor = "one";
      blend.dstFactor = "one";
    }
  }

  function render() {
    makeBlendComponentValid(color);
    makeBlendComponentValid(alpha);
    gui.updateDisplay();

    const srcPipeline = device.createRenderPipeline({
      label: "hardcoded textured quad pipeline",
      layout: pipelineLayout,
      vertex: {
        module,
      },
      fragment: {
        module,
        targets: [
          {
            format,
            blend: {
              color,
              alpha,
            },
          },
        ],
      },
    });

    const { srcTexture, dstTexture, srcBindGroup, dstBindGroup } =
      textureSets[settings.textureSet];

    context.configure({
      device,
      format,
      alphaMode: settings.alphaMode,
    });

    const canvasTexture = context.getCurrentTexture();
    renderPassDesc.colorAttachments[0].view = canvasTexture.createView();

    {
      const { alpha, color, premultiply } = clear;
      const mult = premultiply ? alpha : 1;
      clearValue[0] = color[0] * mult;
      clearValue[1] = color[1] * mult;
      clearValue[2] = color[2] * mult;
      clearValue[3] = alpha;
    }

    /**
     * @param {GPUTexture} canvasTexture
     * @param {GPUTexture} texture
     */
    function updateUniforms(uniform, canvasTexture, texture) {
      const projectionMatrix = mat4.ortho(
        0,
        canvasTexture.width,
        canvasTexture.height,
        0,
        -1,
        1,
      );

      mat4.scale(
        projectionMatrix,
        [texture.width, texture.height, 1],
        uniform.matrix,
      );

      device.queue.writeBuffer(uniform.buffer, 0, uniform.values);
    }

    updateUniforms(srcUniform, canvasTexture, srcTexture);
    updateUniforms(dstUniform, canvasTexture, dstTexture);

    const encoder = device.createCommandEncoder({ label: "our demo encoder" });
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(dstPipeline);
    pass.setBindGroup(0, dstBindGroup);
    pass.draw(6);

    pass.setPipeline(srcPipeline);
    pass.setBindGroup(0, srcBindGroup);
    pass.setBlendConstant([...constant.color, constant.alpha]);
    pass.draw(6);

    pass.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(
        1,
        Math.min(width, device.limits.maxTextureDimension2D),
      );
      canvas.height = Math.max(
        1,
        Math.min(height, device.limits.maxTextureDimension2D),
      );
      render();
    }
  });

  observer.observe(canvas);

  /** @type{Array<GPUBlendOperation>} */
  const operations = ["add", "max", "min", "reverse-subtract", "subtract"];
  /** @type{Array<GPUBlendFactor>} */
  const factors = [
    "constant",
    "dst",
    "dst-alpha",
    "one",
    "one-minus-constant",
    "one-minus-dst",
    "one-minus-dst-alpha",
    "one-minus-src",
    "one-minus-src-alpha",
    "src",
    "src-alpha",
    "src-alpha-saturated",
    "zero",
  ];

  let gui = new GUI().onChange(render);
  gui
    .add(settings, "alphaMode", ["opaque", "premultiplied"])
    .name("canvas alphaMode");
  gui.add(settings, "textureSet", [
    "premultiplied alpha",
    "un-premultiplied alpha",
  ]);
  gui
    .add(settings, "preset", Object.keys(presets))
    .name("blending preset")
    .onChange((presetName) => {
      const preset = presets[presetName];
      Object.assign(color, preset.color);
      Object.assign(alpha, preset.alpha || preset.color);
      gui.updateDisplay();
    });
  const colorFolder = gui.addFolder("color");
  colorFolder.add(color, "operation", operations);
  colorFolder.add(color, "srcFactor", factors);
  colorFolder.add(color, "dstFactor", factors);
  const alphaFolder = gui.addFolder("alpha");
  alphaFolder.add(alpha, "operation", operations);
  alphaFolder.add(alpha, "srcFactor", factors);
  alphaFolder.add(alpha, "dstFactor", factors);
  const constantFolder = gui.addFolder("constant");
  constantFolder.addColor(constant, "color");
  constantFolder.add(constant, "alpha", 0, 1);
  const clearFolder = gui.addFolder("clear color");
  clearFolder.add(clear, "premultiply");
  clearFolder.add(clear, "alpha", 0, 1);
  clearFolder.addColor(clear, "color");
}

main();
