// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { InternalError } from '@rushstack/node-core-library';
import {
  CommandLineParameter,
  CommandLineParameterProvider,
  CommandLineParameterKind,
  CommandLineChoiceParameter,
  CommandLineChoiceListParameter,
  CommandLineFlagParameter,
  CommandLineIntegerParameter,
  CommandLineIntegerListParameter,
  CommandLineStringParameter,
  CommandLineStringListParameter
} from '@rushstack/ts-command-line';

import type {
  HeftPluginDefinitionBase,
  IChoiceParameterAlternativeJson,
  IParameterJson
} from '../configuration/HeftPluginDefinition';

/**
 * The default parameters provided by Heft.
 *
 * @public
 */
export interface IHeftDefaultParameters {
  /**
   * Whether or not the `--clean` flag was passed to Heft.
   *
   * @public
   */
  readonly clean: boolean;

  /**
   * Whether or not the `--clean-cache` flag was passed to Heft.
   *
   * @public
   */
  readonly cleanCache: boolean;

  /**
   * Whether or not the `--debug` flag was passed to Heft.
   *
   * @public
   */
  readonly debug: boolean;

  /**
   * Whether or not the `--verbose` flag was passed to the Heft action.
   *
   * @public
   */
  readonly verbose: boolean;

  /**
   * Whether or not the `--production` flag was passed to the Heft action.
   *
   * @public
   */
  readonly production: boolean;

  /**
   * The locales provided to the Heft action via the `--locales` parameter.
   *
   * @public
   */
  readonly locales: Iterable<string>;

  /**
   * Whether or not the Heft action is running in watch mode.
   */
  readonly watch: boolean;

  /**
   * Whether or not the `--serve` flag was passed to the Heft action.
   */
  readonly serve: boolean;
}

/**
 * Parameters provided to a Heft plugin.
 *
 * @public
 */
export interface IHeftParameters extends IHeftDefaultParameters {
  /**
   * Get a choice parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getChoiceParameter(parameterLongName: string): CommandLineChoiceParameter;

  /**
   * Get a choice list parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getChoiceListParameter(parameterLongName: string): CommandLineChoiceListParameter;

  /**
   * Get a flag parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getFlagParameter(parameterLongName: string): CommandLineFlagParameter;

  /**
   * Get an integer parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getIntegerParameter(parameterLongName: string): CommandLineIntegerParameter;

  /**
   * Get an integer list parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getIntegerListParameter(parameterLongName: string): CommandLineIntegerListParameter;

  /**
   * Get a string parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getStringParameter(parameterLongName: string): CommandLineStringParameter;

  /**
   * Get a string list parameter that has been defined in heft-plugin.json.
   *
   * @public
   */
  getStringListParameter(parameterLongName: string): CommandLineStringListParameter;
}

export interface IHeftParameterManagerOptions {
  getIsClean: () => boolean;
  getIsCleanCache: () => boolean;
  getIsDebug: () => boolean;
  getIsVerbose: () => boolean;
  getIsProduction: () => boolean;
  getIsWatch: () => boolean;
  getIsServe: () => boolean;
  getLocales: () => Iterable<string>;
}

export class HeftParameterManager {
  private readonly _options: IHeftParameterManagerOptions;
  // plugin defintiion => parameter accessors and defaults
  private readonly _heftParametersByDefinition: Map<HeftPluginDefinitionBase, IHeftParameters> = new Map();
  // plugin definition => Map< parameter long name => applied parameter >
  private readonly _parametersByDefinition: Map<HeftPluginDefinitionBase, Map<string, CommandLineParameter>> =
    new Map();

  private _isFinalized: boolean = false;

  private _defaultParameters: IHeftDefaultParameters | undefined;
  public get defaultParameters(): IHeftDefaultParameters {
    if (!this._isFinalized) {
      throw new InternalError('Parameters have not yet been finalized.');
    }

    if (!this._defaultParameters) {
      this._defaultParameters = {
        clean: this._options.getIsClean(),
        cleanCache: this._options.getIsCleanCache(),
        debug: this._options.getIsDebug(),
        verbose: this._options.getIsVerbose(),
        production: this._options.getIsProduction(),
        locales: this._options.getLocales(),
        watch: this._options.getIsWatch(),
        serve: this._options.getIsServe()
      };
    }
    return this._defaultParameters;
  }

  public constructor(options: IHeftParameterManagerOptions) {
    this._options = options;
  }

  /**
   * Add parameters provided by the specified plugin definition. Parameters will be registered with the
   * command line parameter provider after finalization.
   */
  public addPluginParameters(pluginDefinition: HeftPluginDefinitionBase): void {
    if (this._isFinalized) {
      throw new InternalError('Parameters have already been finalized.');
    }
    if (!this._parametersByDefinition.has(pluginDefinition)) {
      this._parametersByDefinition.set(pluginDefinition, new Map());
    }
  }

  /**
   * Finalize and register parameters with the specified parameter provider. The parameter manager
   * can only be finalized once.
   */
  public finalizeParameters(commandLineParameterProvider: CommandLineParameterProvider): void {
    if (this._isFinalized) {
      throw new InternalError('Parameters have already been finalized.');
    }
    this._isFinalized = true;
    for (const pluginDefinition of this._parametersByDefinition.keys()) {
      this._addParametersToProvider(pluginDefinition, commandLineParameterProvider);
    }
  }

  /**
   * Get the finalized parameters for the specified plugin definition.
   */
  public getParametersForPlugin(pluginDefinition: HeftPluginDefinitionBase): IHeftParameters {
    if (!this._isFinalized) {
      throw new InternalError('Parameters have not yet been finalized.');
    }

    let heftParameters: IHeftParameters | undefined = this._heftParametersByDefinition.get(pluginDefinition);
    if (!heftParameters) {
      const parameters: Map<string, CommandLineParameter> | undefined =
        this._parametersByDefinition.get(pluginDefinition);
      if (!parameters) {
        throw new InternalError(
          `Parameters from plugin ${JSON.stringify(pluginDefinition.pluginName)} in package ` +
            `${JSON.stringify(pluginDefinition.pluginPackageName)} were not added before finalization.`
        );
      }

      heftParameters = {
        ...this.defaultParameters,

        getChoiceParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.Choice),
        getChoiceListParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.ChoiceList),
        getFlagParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.Flag),
        getIntegerParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.Integer),
        getIntegerListParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.IntegerList),
        getStringParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.String),
        getStringListParameter: (parameterLongName: string) =>
          this._getParameter(parameters, parameterLongName, CommandLineParameterKind.StringList)
      };
      this._heftParametersByDefinition.set(pluginDefinition, heftParameters);
    }
    return heftParameters;
  }

  /**
   * Add the parameters specified by a plugin definition to the command line parameter provider.
   * Duplicate parameters are allowed, as long as they have different parameter scopes. In this
   * case, the parameter will only be referencable by the CLI argument
   * "--<parameterScope>:<parameterName>". If there is no duplicate parameter, it will also be
   * referencable by the CLI argument "--<parameterName>".
   */
  private _addParametersToProvider(
    pluginDefinition: HeftPluginDefinitionBase,
    commandLineParameterProvider: CommandLineParameterProvider
  ): void {
    const definedPluginParametersByName: Map<string, CommandLineParameter> =
      this._parametersByDefinition.get(pluginDefinition)!;

    // Error if a plugin defines a parameter multiple times
    for (const parameter of pluginDefinition.pluginParameters) {
      if (definedPluginParametersByName.has(parameter.longName)) {
        throw new Error(
          `Parameter ${JSON.stringify(parameter.longName)} is defined multiple times by the providing ` +
            `plugin ${JSON.stringify(pluginDefinition.pluginName)} in package ` +
            `${JSON.stringify(pluginDefinition.pluginPackageName)}.`
        );
      }

      // Short names are excluded since it would be difficult and confusing to de-dupe/handle shortname
      // conflicts as well as longname conflicts
      let definedParameter: CommandLineParameter;
      switch (parameter.parameterKind) {
        case 'choiceList': {
          definedParameter = commandLineParameterProvider.defineChoiceListParameter({
            description: parameter.description,
            required: parameter.required,
            alternatives: parameter.alternatives.map((p: IChoiceParameterAlternativeJson) => p.name),
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'choice': {
          definedParameter = commandLineParameterProvider.defineChoiceParameter({
            description: parameter.description,
            required: parameter.required,
            alternatives: parameter.alternatives.map((p: IChoiceParameterAlternativeJson) => p.name),
            defaultValue: parameter.defaultValue,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'flag': {
          definedParameter = commandLineParameterProvider.defineFlagParameter({
            description: parameter.description,
            required: parameter.required,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'integerList': {
          definedParameter = commandLineParameterProvider.defineIntegerListParameter({
            description: parameter.description,
            required: parameter.required,
            argumentName: parameter.argumentName,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'integer': {
          definedParameter = commandLineParameterProvider.defineIntegerParameter({
            description: parameter.description,
            required: parameter.required,
            argumentName: parameter.argumentName,
            defaultValue: parameter.defaultValue,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'stringList': {
          definedParameter = commandLineParameterProvider.defineStringListParameter({
            description: parameter.description,
            required: parameter.required,
            argumentName: parameter.argumentName,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        case 'string': {
          definedParameter = commandLineParameterProvider.defineStringParameter({
            description: parameter.description,
            required: parameter.required,
            argumentName: parameter.argumentName,
            defaultValue: parameter.defaultValue,
            parameterLongName: parameter.longName,
            parameterScope: pluginDefinition.pluginParameterScope
          });
          break;
        }
        default: {
          // Need to cast to IParameterJson since it's inferred to be type 'never'
          throw new InternalError(
            `Unrecognized parameter kind: ${(parameter as IParameterJson).parameterKind}`
          );
        }
      }

      // Add the parameter to the map using the original long name, so that it can be retrieved by plugins
      // under the original long name.
      definedPluginParametersByName.set(parameter.longName, definedParameter);
    }
  }

  private _getParameter<T extends CommandLineParameter>(
    parametersByLongName: Map<string, CommandLineParameter>,
    parameterLongName: string,
    expectedParameterKind: CommandLineParameterKind
  ): T {
    const parameter: CommandLineParameter | undefined = parametersByLongName.get(parameterLongName);
    if (!parameter) {
      throw new Error(
        `Parameter ${JSON.stringify(parameterLongName)} not found. Are you sure it was defined in ` +
          'heft-plugin.json?'
      );
    } else if (parameter.kind !== expectedParameterKind) {
      throw new Error(
        `Parameter ${JSON.stringify(parameterLongName)} is of kind ` +
          `${JSON.stringify(CommandLineParameterKind[parameter.kind])}, not of kind ` +
          `${JSON.stringify(CommandLineParameterKind[expectedParameterKind])}.`
      );
    }
    return parameter as T;
  }
}
