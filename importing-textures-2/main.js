import { mat4 } from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

function numMipLevels(...sizes) {
	const maxSize = Math.max(...sizes);
	return 1 + Math.log2(maxSize) | 0;
}

/**
 * @param {RequestInfo | URL} input
 * @returns {Promise<ImageBitmap>}
 */
async function loadImageBitmap(input) {
	const resp = await fetch(input);
	const blob = await resp.blob();
	return createImageBitmap(blob, { colorSpaceConversion: "none" });
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
				label: 'textured quad shaders for mip level generation',
				code: /* wgsl */`
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
				`
			});

			sampler = device.createSampler({
				minFilter: "linear"
			});
		}

		if (!pipelineByFormat[texture.format]) {
			pipelineByFormat[texture.format] = device.createRenderPipeline({
				layout: "auto",
				vertex: {
					module
				},
				fragment: {
					module,
					targets: [{ format: texture.format }],
				}
			});
		}
		const pipeline = pipelineByFormat[texture.format];

		const encoder = device.createCommandEncoder({
			label: "mip gen encoder",
		});

		for (let baseMipLevel = 1; baseMipLevel < texture.mipLevelCount; baseMipLevel++) {
			const bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: sampler },
					{
						binding: 1,
						resource: texture.createView({
							baseMipLevel: baseMipLevel - 1,
							mipLevelCount: 1
						})
					}
				]
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
					}
				]
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
function copySourceToTexture(device, texture, source, { flipY } = {}) {
	const { width, height } = source;
	device.queue.copyExternalImageToTexture(
		{ source, flipY },
		{ texture },
		{ width, height }
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
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
	});
	copySourceToTexture(device, texture, source, options);
	return texture;
}

/**
 * @param {GPUDevice} device
 * @param {RequestInfo | URL} input
 * @returns {GPUTexture}
 */
async function createTextureFromImage(device, url, options) {
	const imgBitmap = await loadImageBitmap(url);
	return createTextureFromSource(device, imgBitmap, options);
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
		format
	});

	const module = device.createShaderModule({
		label: "our hardcoded RGB triangle shaders",
		code: /* wgsl */`
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
				vsOutput.texcoord = xy * vec2f(1, 50);
				return vsOutput;
			}

			@group(0) @binding(0) var ourSampler: sampler;
			@group(0) @binding(1) var ourTexture: texture_2d<f32>;

			@fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
				return textureSample(ourTexture, ourSampler, fsInput.texcoord);
			}
		`
	});

	const pipeline = device.createRenderPipeline({
		label: "demo render pipeline",
		layout: "auto",
		vertex: {
			entryPoint: "vs",
			module,
		},
		fragment: {
			entryPoint: "fs",
			module,
			targets: [{ format }],
		}
	});

	const textures = await Promise.all([
		createTextureFromImage(device, "https://webgpufundamentals.org/webgpu/resources/images/f-texture.png", { mips: true, flipY: false }),
		createTextureFromImage(device, "https://webgpufundamentals.org/webgpu/resources/images/coins.jpg", { mips: true }),
		createTextureFromImage(device, "https://webgpufundamentals.org/webgpu/resources/images/Granite_paving_tileable_512x512.jpeg", { mips: true }),
	]);

	const kMatrixOffset = 0;

	const objectInfos = [];
	for (let i = 0; i < 8; i++) {
		const sampler = device.createSampler({
			addressModeU: "repeat",
			addressModeV: "repeat",
			magFilter: (i & 1) ? "linear" : "nearest",
			minFilter: (i & 2) ? "linear" : "nearest",
			mipmapFilter: (i & 4) ? "linear" : "nearest",
		});

		const uniformValues = new Float32Array(16);
		const matrix = uniformValues.subarray(kMatrixOffset, 16);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const bindGroups = textures.map(texture => device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture },
				{ binding: 2, resource: uniformBuffer },
			]
		}));

		objectInfos.push({
			bindGroups,
			matrix,
			uniformValues,
			uniformBuffer,
		});
	}

	const renderPassDesc = {
		label: "demo render pass descriptor",
		colorAttachments: [
			{
				//view: TODO
				clearValue: [0.3, 0.3, 0.3, 1.0],
				loadOp: "clear",
				storeOp: "store",
			}
		]
	};

	let texInd = 0;

	function render() {
		const fov = 60 * Math.PI / 180; // 60 deg in radians
		const aspect = canvas.clientWidth / canvas.clientHeight;
		const zNear = 1;
		const zFar = 2000;
		const projectionMatrix = mat4.perspective(fov, aspect, zNear, zFar);

		const cameraPosition = [0, 0, 2];
		const up = [0, 1, 0];
		const target = [0, 0, 0];
		const viewMatrix = mat4.lookAt(cameraPosition, target, up);
		const viewProjectionMatrix = mat4.multiply(projectionMatrix, viewMatrix);

		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);

		objectInfos.forEach(({ bindGroups, matrix, uniformValues, uniformBuffer }, i) => {
			const bindGroup = bindGroups[texInd];

			const xSpacing = 1.2;
			const ySpacing = 0.7;
			const zDepth = 50;

			const x = i % 4 - 1.5;
			const y = i < 4 ? 1 : -1;

			mat4.translate(viewProjectionMatrix, [x * xSpacing, y * ySpacing, -zDepth * 0.5], matrix);
			mat4.rotateX(matrix, 0.5 * Math.PI, matrix);
			mat4.scale(matrix, [1, zDepth * 2, 1], matrix);
			mat4.translate(matrix, [-0.5, -0.5, 0], matrix);

			device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

			pass.setBindGroup(0, bindGroup);
			pass.draw(6)
		});

		pass.end();

		const commandBuffer = encoder.finish();
		device.queue.submit([commandBuffer]);
	}

	const observer = new ResizeObserver(entries => {
		for (const entry of entries) {
			const canvas = entry.target;
			const width = entry.contentBoxSize[0].inlineSize;
			const height = entry.contentBoxSize[0].blockSize;
			canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
			canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
			render();
		}
	});

	observer.observe(canvas);

	canvas.addEventListener("click", () => {
		texInd = (texInd + 1) % textures.length;
		render();
	});
}

main()
