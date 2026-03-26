import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/ElementRepository';

test.describe('getSelector — Appium platform formatting', () => {

  const mockData = {
    pages: [
      {
        name: 'TestPage',
        platform: 'android',
        elements: [
          { elementName: 'byAccessibilityId', selector: { 'accessibility id': 'Login' } },
          { elementName: 'byXpath', selector: { xpath: '//android.widget.Button' } },
          { elementName: 'byId', selector: { id: 'submit-btn' } },
          { elementName: 'byCss', selector: { css: 'button.primary' } },
          { elementName: 'byUiAutomator', selector: { uiautomator: 'new UiSelector().text("Submit")' } },
          { elementName: 'byText', selector: { text: 'Submit' } },
          { elementName: 'byClassName', selector: { 'class name': 'android.widget.EditText' } },
          { elementName: 'byUnknown', selector: { nativeId: 'com.example.button' } },
        ],
      },
      {
        name: 'TestPage',
        platform: 'ios',
        elements: [
          { elementName: 'byAccessibilityId', selector: { 'accessibility id': 'MyButton' } },
          { elementName: 'byXpath', selector: { xpath: '//XCUIElementTypeButton' } },
          { elementName: 'byPredicate', selector: { predicate: 'label == "Login"' } },
          { elementName: 'byClassChain', selector: { 'class chain': '**/XCUIElementTypeButton' } },
          { elementName: 'byText', selector: { text: 'Submit' } },
          { elementName: 'byClassName', selector: { 'class name': 'XCUIElementTypeTextField' } },
        ],
      },
    ],
  };

  test.describe('Android', () => {
    const repo = new ElementRepository(mockData, undefined, 'android');

    test('accessibility id → ~value', () => {
      expect(repo.getSelector('TestPage', 'byAccessibilityId')).toBe('~Login');
    });

    test('xpath → raw value', () => {
      expect(repo.getSelector('TestPage', 'byXpath')).toBe('//android.widget.Button');
    });

    test('id → #value', () => {
      expect(repo.getSelector('TestPage', 'byId')).toBe('#submit-btn');
    });

    test('css → css=value', () => {
      expect(repo.getSelector('TestPage', 'byCss')).toBe('css=button.primary');
    });

    test('uiautomator → android=value', () => {
      expect(repo.getSelector('TestPage', 'byUiAutomator')).toBe('android=new UiSelector().text("Submit")');
    });

    test('text → UiSelector text query', () => {
      expect(repo.getSelector('TestPage', 'byText')).toBe('android=new UiSelector().text("Submit")');
    });

    test('class name → raw value', () => {
      expect(repo.getSelector('TestPage', 'byClassName')).toBe('android.widget.EditText');
    });

    test('unknown strategy → raw value', () => {
      expect(repo.getSelector('TestPage', 'byUnknown')).toBe('com.example.button');
    });
  });

  test.describe('iOS', () => {
    const repo = new ElementRepository(mockData, undefined, 'ios');

    test('accessibility id → ~value', () => {
      expect(repo.getSelector('TestPage', 'byAccessibilityId')).toBe('~MyButton');
    });

    test('xpath → raw value', () => {
      expect(repo.getSelector('TestPage', 'byXpath')).toBe('//XCUIElementTypeButton');
    });

    test('predicate → -ios predicate string:value', () => {
      expect(repo.getSelector('TestPage', 'byPredicate')).toBe('-ios predicate string:label == "Login"');
    });

    test('class chain → -ios class chain:value', () => {
      expect(repo.getSelector('TestPage', 'byClassChain')).toBe('-ios class chain:**/XCUIElementTypeButton');
    });

    test('text → -ios predicate string label', () => {
      expect(repo.getSelector('TestPage', 'byText')).toBe('-ios predicate string:label == "Submit"');
    });

    test('class name → raw value', () => {
      expect(repo.getSelector('TestPage', 'byClassName')).toBe('XCUIElementTypeTextField');
    });
  });

  test.describe('Unknown platform', () => {
    const unknownData = {
      pages: [{
        name: 'TestPage',
        platform: 'windows',
        elements: [
          { elementName: 'byText', selector: { text: 'Submit' } },
        ],
      }],
    };
    const repo = new ElementRepository(unknownData, undefined, 'windows');

    test('text for unknown platform → raw value', () => {
      expect(repo.getSelector('TestPage', 'byText')).toBe('Submit');
    });
  });
});
