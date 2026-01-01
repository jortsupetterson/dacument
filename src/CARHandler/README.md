`.car` stands for **Conflict Aware Replica**.

It is a file format that extends JSON, paired with a specified reader named `CARReader` that can be implemented in any programming language.

## Properties

- Embedded access control
- Cryptographically verifiable trust model
- Conflict-aware merge and patch
- User experience and user-centric design

## Goal

The goal of this project is to standardize an application state model that prioritizes **user intention** and provides a **user interface development–compatible programming interface**.

This means it should be straightforward to build a reactive connection between the state stored in the file and the state produced by user interface components. Changes made by an actor with valid access, at the time they perceive the change to happen on their machine, must be preserved by merge semantics, enforced by a hierarchical access control structure, and backed by a cryptographically verifiable trust model.
